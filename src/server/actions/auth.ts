'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getRequestMeta } from '../request';
import { authenticate, findUserById, recordSuccessfulLogin, registerUser, verifyMfaChallenge } from '../services/auth';
import { createSession, destroyCurrentSession, getSessionFromCookie } from '../auth/session';
import { getCurrentUser } from '../auth/dal';
import { recordAudit } from '../audit';
import { email, fail, formValues, invalid, safeNext, text } from './form';
import type { ActionState } from '@/lib/action-state';

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const parsed = z.object({ email: email(), password: z.string().min(1, 'Password is required.').max(256) }).safeParse(values);
  if (!parsed.success) return invalid(parsed.error, { email: values.email });

  const meta = await getRequestMeta();
  const result = await authenticate(parsed.data.email, parsed.data.password, meta);
  const next = safeNext(values.next);

  switch (result.status) {
    case 'rate_limited':
      return fail(`Too many sign-in attempts from your network. Try again in ${result.minutes} minute(s).`, { values: { email: parsed.data.email } });
    case 'locked':
      return fail(`This account is temporarily locked after repeated failed attempts. Try again in ${result.minutes} minute(s) or contact an administrator.`, {
        values: { email: parsed.data.email },
      });
    case 'invalid':
      return fail(GENERIC_LOGIN_ERROR, { values: { email: parsed.data.email } });
    case 'mfa_required':
      await destroyCurrentSession();
      await createSession(result.user.id, 'mfa_pending', meta);
      redirect(`/login/mfa?next=${encodeURIComponent(next)}`);
    case 'ok':
      await destroyCurrentSession();
      await createSession(result.user.id, 'active', meta);
      await recordSuccessfulLogin(result.user, meta, 'password');
      redirect(next);
  }
}

export async function mfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const session = await getSessionFromCookie();
  if (!session || session.stage !== 'mfa_pending') redirect('/login?expired=1');
  const user = await findUserById(session.userId);
  if (!user || !user.isActive) redirect('/login');

  const meta = await getRequestMeta();
  const code = String(values.code ?? '').replace(/\s+/g, '');
  if (!await verifyMfaChallenge(user, code, meta)) return fail('That code is not valid. Check your authenticator app and try again.');

  // Rotate the session token now that both factors are verified.
  await destroyCurrentSession();
  await createSession(user.id, 'active', meta);
  await recordSuccessfulLogin(user, meta, 'password+totp');
  redirect(safeNext(values.next));
}

export async function registerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const schema = z
    .object({
      fullName: text('Full name', 2, 100),
      email: email(),
      password: z.string().max(128, 'Use at most 128 characters.'),
      confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });
  const keep = { fullName: values.fullName, email: values.email };
  const parsed = schema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error, keep);

  const meta = await getRequestMeta();
  const result = await registerUser(parsed.data, meta);
  if (!result.ok) {
    return fail(result.error, { values: keep, fieldErrors: result.field ? { [result.field]: result.error } : undefined });
  }
  await destroyCurrentSession();
  await createSession(result.user.id, 'active', meta);
  await recordSuccessfulLogin(result.user, meta, 'password');
  redirect('/dashboard?welcome=1');
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) await recordAudit({ actor: user, ...(await getRequestMeta()) }, { action: 'auth.logout' });
  await destroyCurrentSession();
  redirect('/login?signedOut=1');
}
