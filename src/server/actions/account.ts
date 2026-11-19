'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actionUser } from '../auth/dal';
import { beginMfaSetup, changePassword, confirmMfaSetup, disableMfa } from '../services/auth';
import { revokeUserSessions } from '../auth/session';
import { recordAudit } from '../audit';
import { done, fail, formValues, invalid } from './form';
import type { ActionState } from '@/lib/action-state';

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser({ allowPendingSetup: true });
  const parsed = z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password.').max(256),
      newPassword: z.string().max(128),
      confirmPassword: z.string(),
    })
    .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' })
    .safeParse(formValues(fd));
  if (!parsed.success) return invalid(parsed.error);
  const r = await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword, ctx, user.sessionId);
  if (!r.ok) return fail(r.error, { fieldErrors: r.field ? { [r.field]: r.error } : undefined });
  revalidatePath('/account');
  return done('Password changed. Your other sessions have been signed out.');
}

export async function beginMfaAction(_prev: ActionState): Promise<ActionState> {
  const { user } = await actionUser({ allowPendingSetup: true });
  const setup = await beginMfaSetup(user.id);
  if (!setup) return fail('Multi-factor authentication is already enabled.');
  return done(undefined, { data: { secret: setup.secret, qrDataUrl: setup.qrDataUrl } });
}

export async function confirmMfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser({ allowPendingSetup: true });
  const code = String(fd.get('code') ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code from your authenticator app.', { data: dataFrom(fd) });
  if (!await confirmMfaSetup(user.id, code, ctx, user.sessionId)) {
    return fail('That code did not match. Make sure your device clock is correct and try again.', { data: dataFrom(fd) });
  }
  revalidatePath('/account');
  return done('Multi-factor authentication is now enabled.');
}

// Keep the QR/secret visible after a failed confirmation attempt.
const dataFrom = (fd: FormData) => ({ secret: String(fd.get('secret') ?? ''), qrDataUrl: String(fd.get('qrDataUrl') ?? '') });

export async function disableMfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, ctx } = await actionUser({ allowPendingSetup: true });
  const r = await disableMfa(user.id, String(fd.get('password') ?? ''), String(fd.get('code') ?? ''), ctx);
  if (!r.ok) return fail(r.error);
  revalidatePath('/account');
  return done('Multi-factor authentication has been turned off.');
}

export async function signOutOtherSessionsAction(_prev: ActionState): Promise<ActionState> {
  const { user, ctx } = await actionUser({ allowPendingSetup: true });
  const n = await revokeUserSessions(user.id, user.sessionId);
  await recordAudit(ctx, { action: 'auth.sessions_revoked', entityType: 'user', entityId: user.id, details: { count: n, scope: 'other_sessions' } });
  revalidatePath('/account');
  return done(n ? `Signed out ${n} other session(s).` : 'No other active sessions.');
}
