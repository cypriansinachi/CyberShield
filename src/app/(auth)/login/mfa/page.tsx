import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { ActionForm, Field, Input, SubmitButton } from '@/components/ui/form';
import { mfaAction } from '@/server/actions/auth';
import { getSessionFromCookie } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Two-step verification' };

export default async function MfaPage({ searchParams }: PageProps<'/login/mfa'>) {
  const session = await getSessionFromCookie();
  if (!session || session.stage !== 'mfa_pending') redirect('/login?expired=1');
  const sp = await searchParams;

  return (
    <>
      <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <KeyRound className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">Two-step verification</h2>
      <p className="mt-1 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app to finish signing in.</p>

      <ActionForm action={mfaAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={typeof sp.next === 'string' ? sp.next : ''} />
        <Field label="Authentication code" name="code">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            className="h-11 text-center font-mono text-lg tracking-[0.5em]"
            placeholder="000000"
          />
        </Field>
        <SubmitButton className="w-full" pendingText="Verifying…">
          Verify and sign in
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Lost your device? Contact your administrator to reset MFA. <br />
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
