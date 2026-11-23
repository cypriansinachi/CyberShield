import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Field, Input, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/misc';
import { loginAction } from '@/server/actions/auth';
import { config } from '@/server/config';

export const metadata: Metadata = { title: 'Sign in' };

const DEMO_ACCOUNTS = [
  ['admin@nexora.local', 'System Administrator'],
  ['manager@nexora.local', 'Security Manager'],
  ['analyst@nexora.local', 'Security Analyst'],
  ['auditor@nexora.local', 'Compliance Auditor'],
  ['customer@example.com', 'Customer'],
];

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : '';
  const showDemo = process.env.SHOW_DEMO_ACCOUNTS === 'true';

  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
      <p className="mt-1 text-sm text-muted-foreground">Use your CyberShield account to continue.</p>

      <div className="mt-6 space-y-3">
        {sp.expired && <Alert tone="warning">Your session has ended. Please sign in again.</Alert>}
        {sp.signedOut && <Alert tone="success">You have been signed out securely.</Alert>}
      </div>

      <ActionForm action={loginAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email address" name="email">
          <Input name="email" type="email" autoComplete="username" required autoFocus placeholder="you@example.com" />
        </Field>
        <Field label="Password" name="password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>

      {config.security.allowSelfRegistration && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to CyberShield?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      )}

      {showDemo && (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-muted/40 p-4 text-xs">
          <p className="font-medium text-foreground">Demo accounts</p>
          <p className="mt-0.5 text-muted-foreground">
            Password for all: <code className="rounded bg-card px-1 py-0.5 font-mono text-foreground">Demo@Passw0rd!</code>
          </p>
          <ul className="mt-2 space-y-1">
            {DEMO_ACCOUNTS.map(([email, role]) => (
              <li key={email} className="flex justify-between gap-2">
                <code className="font-mono text-foreground">{email}</code>
                <span className="text-muted-foreground">{role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
