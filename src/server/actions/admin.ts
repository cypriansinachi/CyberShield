'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actionUser, deny } from '../auth/dal';
import { recordAudit } from '../audit';
import { verifyAuditChain } from '../audit';
import * as users from '../services/users';
import { markAllRead } from '../services/notifications';
import { done, email, fail, formValues, idParam, invalid, text } from './form';
import type { ActionState } from '@/lib/action-state';
import { can, ROLE_KEYS } from '@/lib/rbac';
import { DEPARTMENTS } from '@/lib/constants';

async function adminUser() {
  const { user, ctx } = await actionUser();
  return { user, ctx, allowed: can(user, 'user.manage') };
}

/** Team members belong to a department; customers have none (empty → null). */
const optionalDepartment = z
  .union([z.enum(DEPARTMENTS), z.literal('')], { error: 'Select a department.' })
  .transform((v) => v || null);

export async function createUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx, allowed } = await adminUser();
  if (!allowed) return { status: 'error', message: (await deny(user, 'user.manage')).error };
  const values = formValues(fd);
  const parsed = z
    .object({
      fullName: text('Full name', 2, 100),
      email: email(),
      department: optionalDepartment,
      role: z.enum(ROLE_KEYS, { error: 'Select a role.' }),
    })
    .safeParse(values);
  if (!parsed.success) return invalid(parsed.error, values);
  const r = await users.adminCreateUser(parsed.data, ctx);
  if (!r.ok) return fail(r.error, { values, fieldErrors: r.field ? { [r.field]: r.error } : undefined });
  revalidatePath('/admin/users');
  return done(`Account created for ${r.user.fullName}.`, { data: { tempPassword: r.tempPassword, userId: r.user.id, email: r.user.email } });
}

export async function updateUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx, allowed } = await adminUser();
  if (!allowed) return { status: 'error', message: (await deny(user, 'user.manage')).error };
  const parsed = z
    .object({
      userId: idParam,
      role: z.enum(ROLE_KEYS),
      department: optionalDepartment,
      isActive: z.enum(['true', 'false']).transform((v) => v === 'true'),
    })
    .safeParse(formValues(fd));
  if (!parsed.success) return invalid(parsed.error);
  const { userId, ...patch } = parsed.data;
  const r = await users.adminUpdateUser(userId, patch, ctx);
  if (!r.ok) return fail(r.error);
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/admin/users');
  return done('Account updated. Any privilege change takes effect immediately.');
}

export async function userSecurityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx, allowed } = await adminUser();
  if (!allowed) return { status: 'error', message: (await deny(user, 'user.manage')).error };
  const parsed = z
    .object({ userId: idParam, op: z.enum(['unlock', 'reset_mfa', 'reset_password', 'revoke_sessions']) })
    .safeParse(formValues(fd));
  if (!parsed.success) return fail('Invalid request.');
  const { userId, op } = parsed.data;
  if (userId === user.id && op !== 'unlock') return fail('Use your own Account page to manage your credentials.');

  let res: ActionState;
  switch (op) {
    case 'unlock':
      await users.unlockUser(userId, ctx);
      res = done('Account unlocked.');
      break;
    case 'reset_mfa':
      await users.resetUserMfa(userId, ctx);
      res = done('MFA reset. The user must enrol again and has been signed out.');
      break;
    case 'revoke_sessions':
      res = done(`Signed out ${await users.revokeSessionsFor(userId, ctx)} session(s).`);
      break;
    case 'reset_password': {
      const temp = await users.resetUserPassword(userId, ctx);
      res = temp ? done('Temporary password generated. Share it securely; it must be changed at next sign-in.', { data: { tempPassword: temp } }) : fail('User not found.');
      break;
    }
  }
  revalidatePath(`/admin/users/${userId}`);
  return res;
}

export async function verifyAuditAction(_prev: ActionState): Promise<ActionState> {
  const { user, ctx } = await actionUser();
  if (!can(user, 'audit.view')) return { status: 'error', message: (await deny(user, 'audit.view')).error };
  const v = await verifyAuditChain();
  await recordAudit(ctx, { action: 'audit.chain_verified', outcome: v.ok ? 'success' : 'failure', details: { checked: v.checked, brokenAt: v.brokenAt } });
  return v.ok
    ? done(`Integrity verified: all ${v.checked.toLocaleString('en')} entries are intact and correctly chained.`, { data: { ok: true, head: v.headHash } })
    : fail(`Integrity check FAILED at entry #${v.brokenAt}: ${v.reason}`, { data: { ok: false, brokenAt: v.brokenAt } });
}

export async function markAllReadAction(): Promise<void> {
  const { user } = await actionUser({ allowPendingSetup: true });
  await markAllRead(user.id);
  revalidatePath('/', 'layout');
}
