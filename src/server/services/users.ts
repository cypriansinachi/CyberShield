import 'server-only';
/** User administration (System Administrator only). All changes are audited. */
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { auditLogs, users, type User } from '../db/schema';
import { recordAudit, type AuditContext } from '../audit';
import { generateTempPassword, hashPassword } from '../security/crypto';
import { revokeUserSessions } from '../auth/session';
import { findUserByEmail, findUserById } from './auth';
import { RESPONDER_ROLES, type Role } from '@/lib/rbac';

const nowIso = () => new Date().toISOString();
export type SafeUser = Omit<User, 'passwordHash' | 'mfaSecretEnc' | 'mfaLastCounter'>;

export function toSafeUser(u: User): SafeUser {
  const { passwordHash: _p, mfaSecretEnc: _s, mfaLastCounter: _c, ...safe } = u;
  return safe;
}

export async function listUsers(filters: { q?: string; role?: string } = {}): Promise<SafeUser[]> {
  const conds = [];
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(sql`${users.fullName} LIKE ${pattern} ESCAPE '\\'`, sql`${users.email} LIKE ${pattern} ESCAPE '\\'`));
  }
  if (filters.role) conds.push(eq(users.role, filters.role as Role));
  const rows = await (await getDb())
    .select()
    .from(users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(users.fullName))
    .all();
  return rows.map(toSafeUser);
}

export async function listResponders() {
  return (await getDb())
    .select({ id: users.id, fullName: users.fullName, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, RESPONDER_ROLES)))
    .orderBy(asc(users.fullName))
    .all();
}

export async function getUser(id: number): Promise<SafeUser | null> {
  const u = await findUserById(id);
  return u ? toSafeUser(u) : null;
}

export async function recentAuditForUser(userId: number, limit = 15) {
  return (await getDb())
    .select()
    .from(auditLogs)
    .where(or(eq(auditLogs.actorId, userId), and(eq(auditLogs.entityType, 'user'), eq(auditLogs.entityId, String(userId)))))
    .orderBy(desc(auditLogs.id))
    .limit(limit)
    .all();
}

export async function adminCreateUser(
  input: { fullName: string; email: string; department: string; role: Role },
  ctx: AuditContext,
): Promise<{ ok: true; user: SafeUser; tempPassword: string } | { ok: false; error: string; field?: string }> {
  const email = input.email.trim().toLowerCase();
  if (await findUserByEmail(email)) return { ok: false, field: 'email', error: 'An account with this email address already exists.' };
  const tempPassword = generateTempPassword();
  const ts = nowIso();
  const user = await (await getDb())
    .insert(users)
    .values({
      fullName: input.fullName,
      email,
      department: input.department,
      role: input.role,
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      passwordChangedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
  await recordAudit(ctx, { action: 'user.created', entityType: 'user', entityId: user.id, details: { email, role: input.role } });
  return { ok: true, user: toSafeUser(user), tempPassword };
}

export async function adminUpdateUser(
  id: number,
  patch: { role: Role; department: string; isActive: boolean },
  ctx: AuditContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await findUserById(id);
  if (!user) return { ok: false, error: 'User not found.' };
  if (ctx.actor?.id === id && (patch.role !== user.role || !patch.isActive)) {
    return { ok: false, error: 'You cannot change your own role or deactivate your own account.' };
  }
  await (await getDb())
    .update(users)
    .set({ role: patch.role, department: patch.department, isActive: patch.isActive, updatedAt: nowIso() })
    .where(eq(users.id, id))
    .run();

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (user.role !== patch.role) changes.role = { from: user.role, to: patch.role };
  if (user.department !== patch.department) changes.department = { from: user.department, to: patch.department };
  if (user.isActive !== patch.isActive) changes.isActive = { from: user.isActive, to: patch.isActive };

  // A privilege change or deactivation takes effect immediately on every device.
  let sessionsRevoked = 0;
  if (changes.role || (changes.isActive && !patch.isActive)) sessionsRevoked = await revokeUserSessions(id);
  if (Object.keys(changes).length) {
    await recordAudit(ctx, {
      action: changes.role ? 'user.role_changed' : changes.isActive ? (patch.isActive ? 'user.activated' : 'user.deactivated') : 'user.updated',
      entityType: 'user',
      entityId: id,
      details: { email: user.email, changes, sessionsRevoked },
    });
  }
  return { ok: true };
}

export async function unlockUser(id: number, ctx: AuditContext) {
  const user = await findUserById(id);
  if (!user) return;
  await (await getDb()).update(users).set({ lockedUntil: null, failedLoginCount: 0, updatedAt: nowIso() }).where(eq(users.id, id)).run();
  await recordAudit(ctx, { action: 'user.unlocked', entityType: 'user', entityId: id, details: { email: user.email } });
}

export async function resetUserMfa(id: number, ctx: AuditContext) {
  const user = await findUserById(id);
  if (!user) return;
  await (await getDb()).update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaLastCounter: null, updatedAt: nowIso() }).where(eq(users.id, id)).run();
  await revokeUserSessions(id);
  await recordAudit(ctx, { action: 'user.mfa_reset', entityType: 'user', entityId: id, details: { email: user.email } });
}

export async function resetUserPassword(id: number, ctx: AuditContext): Promise<string | null> {
  const user = await findUserById(id);
  if (!user) return null;
  const tempPassword = generateTempPassword();
  await (await getDb())
    .update(users)
    .set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true, lockedUntil: null, failedLoginCount: 0, passwordChangedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(users.id, id))
    .run();
  const revoked = await revokeUserSessions(id);
  await recordAudit(ctx, { action: 'user.password_reset', entityType: 'user', entityId: id, details: { email: user.email, sessionsRevoked: revoked } });
  return tempPassword;
}

export async function revokeSessionsFor(id: number, ctx: AuditContext) {
  const n = await revokeUserSessions(id);
  await recordAudit(ctx, { action: 'user.sessions_revoked', entityType: 'user', entityId: id, details: { count: n } });
  return n;
}
