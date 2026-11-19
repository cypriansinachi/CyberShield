import 'server-only';
/**
 * Authentication: password sign-in with lockout, TOTP multi-factor
 * authentication, self-registration and password changes. Every outcome,
 * successful or not, is written to the audit trail.
 */
import QRCode from 'qrcode';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, type User } from '../db/schema';
import { config } from '../config';
import { recordAudit, type AuditContext } from '../audit';
import { dummyPasswordHash, hashPassword, verifyPassword, encryptString, decryptString } from '../security/crypto';
import { generateTotpSecret, totpKeyUri, verifyTotp } from '../security/totp';
import { rateLimit } from '../security/rate-limit';
import { revokeUserSessions } from '../auth/session';
import { notifyRoles } from './notifications';
import { checkPassword } from '@/lib/password-policy';
import { APP_NAME } from '@/lib/constants';
import type { RequestMeta } from '../request';

const nowIso = () => new Date().toISOString();
const actorOf = (u: User) => ({ id: u.id, email: u.email, role: u.role });

export async function findUserByEmail(email: string) {
  return (await getDb()).select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
}
export async function findUserById(id: number) {
  return (await getDb()).select().from(users).where(eq(users.id, id)).get();
}

export type AuthResult =
  | { status: 'ok'; user: User }
  | { status: 'mfa_required'; user: User }
  | { status: 'invalid' }
  | { status: 'locked'; minutes: number }
  | { status: 'rate_limited'; minutes: number };

export async function authenticate(emailRaw: string, password: string, meta: RequestMeta): Promise<AuthResult> {
  const email = emailRaw.trim().toLowerCase();
  const ctx: AuditContext = { ...meta };

  const rl = await rateLimit(`login:${meta.ip ?? 'unknown'}`, config.security.authRateLimitPerWindow, config.security.authRateWindowMinutes * 60_000);
  if (!rl.allowed) {
    await recordAudit(ctx, { action: 'auth.rate_limited', outcome: 'denied', details: { email } });
    return { status: 'rate_limited', minutes: Math.ceil(rl.retryAfterMs / 60_000) };
  }

  const user = await findUserByEmail(email);
  if (!user || !user.isActive) {
    // Spend the same time as a real check so response timing does not reveal valid emails.
    await verifyPassword(password, await dummyPasswordHash());
    await recordAudit(ctx, {
      action: 'auth.login_failed',
      outcome: 'failure',
      details: { email, reason: user ? 'account_disabled' : 'unknown_user' },
    });
    return { status: 'invalid' };
  }

  const userCtx: AuditContext = { ...meta, actor: actorOf(user) };
  if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
    await recordAudit(userCtx, { action: 'auth.login_blocked', outcome: 'denied', details: { reason: 'account_locked' } });
    return { status: 'locked', minutes: Math.ceil((Date.parse(user.lockedUntil) - Date.now()) / 60_000) };
  }

  const db = await getDb();
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failures = user.failedLoginCount + 1;
    if (failures >= config.security.maxLoginAttempts) {
      const lockedUntil = new Date(Date.now() + config.security.lockoutMinutes * 60_000).toISOString();
      await db.update(users).set({ failedLoginCount: 0, lockedUntil, updatedAt: nowIso() }).where(eq(users.id, user.id)).run();
      await recordAudit(userCtx, { action: 'auth.account_locked', outcome: 'failure', details: { failures, lockedUntil } });
      await notifyRoles(['admin'], {
        message: `Account ${user.email} was locked after ${failures} failed sign-in attempts.`,
        link: `/admin/users/${user.id}`,
      });
      return { status: 'locked', minutes: config.security.lockoutMinutes };
    }
    await db.update(users).set({ failedLoginCount: failures, updatedAt: nowIso() }).where(eq(users.id, user.id)).run();
    await recordAudit(userCtx, { action: 'auth.login_failed', outcome: 'failure', details: { reason: 'bad_password', failures } });
    return { status: 'invalid' };
  }

  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, updatedAt: nowIso() }).where(eq(users.id, user.id)).run();
  if (user.mfaEnabled) {
    await recordAudit(userCtx, { action: 'auth.mfa_challenge_issued' });
    return { status: 'mfa_required', user };
  }
  return { status: 'ok', user };
}

export async function recordSuccessfulLogin(user: User, meta: RequestMeta, method: 'password' | 'password+totp') {
  await (await getDb()).update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, user.id)).run();
  await recordAudit({ ...meta, actor: actorOf(user) }, { action: 'auth.login_success', details: { method } });
}

/** Second factor at sign-in. Codes cannot be replayed (last counter is stored). */
export async function verifyMfaChallenge(user: User, code: string, meta: RequestMeta): Promise<boolean> {
  const ctx = { ...meta, actor: actorOf(user) };
  const rl = await rateLimit(`mfa:${user.id}`, 5, 5 * 60_000);
  if (!rl.allowed || !user.mfaEnabled || !user.mfaSecretEnc) {
    await recordAudit(ctx, { action: 'auth.mfa_failed', outcome: rl.allowed ? 'failure' : 'denied', details: { reason: rl.allowed ? 'not_enrolled' : 'rate_limited' } });
    return false;
  }
  const counter = verifyTotp(code, decryptString(user.mfaSecretEnc), { lastCounter: user.mfaLastCounter });
  if (counter === null) {
    await recordAudit(ctx, { action: 'auth.mfa_failed', outcome: 'failure' });
    return false;
  }
  await (await getDb()).update(users).set({ mfaLastCounter: counter }).where(eq(users.id, user.id)).run();
  return true;
}

export type RegisterInput = { fullName: string; email: string; department: string; password: string };

export async function registerUser(input: RegisterInput, meta: RequestMeta): Promise<{ ok: true; user: User } | { ok: false; error: string; field?: string }> {
  const ctx: AuditContext = { ...meta };
  if (!config.security.allowSelfRegistration) return { ok: false, error: 'Self-registration is disabled. Contact your administrator.' };

  const rl = await rateLimit(`register:${meta.ip ?? 'unknown'}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    await recordAudit(ctx, { action: 'auth.rate_limited', outcome: 'denied', details: { endpoint: 'register' } });
    return { ok: false, error: 'Too many registration attempts. Try again later.' };
  }

  const email = input.email.trim().toLowerCase();
  const domain = email.split('@')[1] ?? '';
  const allowed = config.security.allowedEmailDomains;
  if (allowed.length && !allowed.includes(domain)) {
    return { ok: false, field: 'email', error: `Use your organisation email address (${allowed.map((d) => `@${d}`).join(', ')}).` };
  }
  const pwErrors = checkPassword(input.password, { email, fullName: input.fullName });
  if (pwErrors.length) return { ok: false, field: 'password', error: pwErrors.join(' ') };
  if (await findUserByEmail(email)) return { ok: false, field: 'email', error: 'An account with this email address already exists.' };

  const ts = nowIso();
  const user = await (await getDb())
    .insert(users)
    .values({
      fullName: input.fullName,
      email,
      department: input.department,
      role: 'reporter',
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning()
    .get();
  await recordAudit({ ...meta, actor: actorOf(user) }, { action: 'user.registered', entityType: 'user', entityId: user.id, details: { role: 'reporter' } });
  return { ok: true, user };
}

export async function changePassword(
  userId: number,
  current: string,
  next: string,
  ctx: AuditContext,
  keepSessionId: string,
): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
  const user = await findUserById(userId);
  if (!user) return { ok: false, error: 'Account not found.' };
  if (!(await verifyPassword(current, user.passwordHash))) {
    await recordAudit(ctx, { action: 'auth.password_change_failed', outcome: 'failure', details: { reason: 'bad_current_password' } });
    return { ok: false, field: 'currentPassword', error: 'Current password is incorrect.' };
  }
  if (current === next) return { ok: false, field: 'newPassword', error: 'Choose a password different from your current one.' };
  const errors = checkPassword(next, { email: user.email, fullName: user.fullName });
  if (errors.length) return { ok: false, field: 'newPassword', error: errors.join(' ') };

  const ts = nowIso();
  await (await getDb())
    .update(users)
    .set({ passwordHash: await hashPassword(next), passwordChangedAt: ts, mustChangePassword: false, updatedAt: ts })
    .where(eq(users.id, userId))
    .run();
  const revoked = await revokeUserSessions(userId, keepSessionId);
  await recordAudit(ctx, { action: 'auth.password_changed', entityType: 'user', entityId: userId, details: { otherSessionsRevoked: revoked } });
  return { ok: true };
}

/** Step 1 of MFA enrolment: generate a secret (stored encrypted, not yet active). */
export async function beginMfaSetup(userId: number) {
  const user = await findUserById(userId);
  if (!user || user.mfaEnabled) return null;
  const secret = generateTotpSecret();
  await (await getDb()).update(users).set({ mfaSecretEnc: encryptString(secret), mfaLastCounter: null }).where(eq(users.id, userId)).run();
  const uri = totpKeyUri({ secret, account: user.email, issuer: APP_NAME });
  return { secret, uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/** Step 2 of MFA enrolment: prove the authenticator app works, then activate. */
export async function confirmMfaSetup(userId: number, code: string, ctx: AuditContext, keepSessionId: string): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user || user.mfaEnabled || !user.mfaSecretEnc) return false;
  const counter = verifyTotp(code, decryptString(user.mfaSecretEnc));
  if (counter === null) {
    await recordAudit(ctx, { action: 'auth.mfa_enrolment_failed', outcome: 'failure' });
    return false;
  }
  await (await getDb()).update(users).set({ mfaEnabled: true, mfaLastCounter: counter, updatedAt: nowIso() }).where(eq(users.id, userId)).run();
  await revokeUserSessions(userId, keepSessionId);
  await recordAudit(ctx, { action: 'auth.mfa_enabled', entityType: 'user', entityId: userId });
  return true;
}

export async function disableMfa(userId: number, password: string, code: string, ctx: AuditContext) {
  const user = await findUserById(userId);
  if (!user || !user.mfaEnabled || !user.mfaSecretEnc) return { ok: false as const, error: 'MFA is not enabled.' };
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false as const, error: 'Password is incorrect.' };
  if (verifyTotp(code, decryptString(user.mfaSecretEnc), { lastCounter: user.mfaLastCounter }) === null) {
    await recordAudit(ctx, { action: 'auth.mfa_disable_failed', outcome: 'failure' });
    return { ok: false as const, error: 'Authentication code is incorrect.' };
  }
  await (await getDb()).update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaLastCounter: null, updatedAt: nowIso() }).where(eq(users.id, userId)).run();
  await recordAudit(ctx, { action: 'auth.mfa_disabled', entityType: 'user', entityId: userId });
  return { ok: true as const };
}
