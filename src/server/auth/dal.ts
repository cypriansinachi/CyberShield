import 'server-only';
/**
 * Data Access Layer for identity. Every page, Server Action and Route Handler
 * resolves the user through here, so authentication and authorization are
 * checked next to the data, not just in the proxy or the UI.
 */
import { cache } from 'react';
import { redirect, forbidden } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import { config } from '../config';
import { getSessionFromCookie, touchSession } from './session';
import { getRequestMeta } from '../request';
import { recordAudit, type AuditContext } from '../audit';
import { can, PRIVILEGED_ROLES, type Permission, type Role } from '@/lib/rbac';

export type CurrentUser = {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  department: string | null;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  sessionId: string;
};

/** Resolve the signed-in user once per request (React cache). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSessionFromCookie();
  if (!session || session.stage !== 'active') return null;
  const u = await (await getDb()).select().from(users).where(eq(users.id, session.userId)).get();
  if (!u || !u.isActive) return null;
  await touchSession(session);
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    department: u.department,
    mfaEnabled: u.mfaEnabled,
    mustChangePassword: u.mustChangePassword,
    sessionId: session.id,
  };
});

/** Account policies that must be satisfied before using the rest of the app. */
function pendingAccountRequirement(user: CurrentUser): 'password' | 'mfa' | null {
  if (user.mustChangePassword) return 'password';
  if (config.security.requireMfaForPrivileged && PRIVILEGED_ROLES.includes(user.role) && !user.mfaEnabled) return 'mfa';
  return null;
}

export async function requireUser(opts: { allowPendingSetup?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!opts.allowPendingSetup) {
    const pending = pendingAccountRequirement(user);
    if (pending) redirect(`/account?required=${pending}`);
  }
  return user;
}

export async function auditContextFor(user: CurrentUser | null): Promise<AuditContext> {
  return { actor: user, ...(await getRequestMeta()) };
}

/** Page guard: renders the 403 page (and logs the attempt) if not permitted. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) {
    await recordAudit(await auditContextFor(user), { action: 'access.denied', outcome: 'denied', details: { permission } });
    forbidden();
  }
  return user;
}

/**
 * Server Action guard. Server Actions are public HTTP endpoints, so each one
 * re-authenticates instead of trusting that the caller came from our UI.
 */
export async function actionUser(opts: { allowPendingSetup?: boolean } = {}) {
  const user = await requireUser(opts);
  return { user, ctx: await auditContextFor(user) };
}

export async function deny(user: CurrentUser, permission: Permission | string, details: Record<string, unknown> = {}) {
  await recordAudit(await auditContextFor(user), { action: 'access.denied', outcome: 'denied', details: { permission, ...details } });
  return { ok: false as const, error: 'You are not permitted to perform this action.' };
}
