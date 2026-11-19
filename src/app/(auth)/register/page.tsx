import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Field, Input, Select, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/misc';
import { registerAction } from '@/server/actions/auth';
import { config } from '@/server/config';
import { DEPARTMENTS } from '@/lib/constants';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  if (!config.security.allowSelfRegistration) {
    return (
      <Alert tone="info" title="Self-registration is disabled">
        Accounts are created by your administrator. <Link href="/login">Back to sign in</Link>
      </Alert>
    );
  }
  const domains = config.security.allowedEmailDomains;
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
      <p className="mt-1 text-sm text-muted-foreground">Staff accounts can report incidents and follow their progress.</p>

      <ActionForm action={registerAction} className="mt-6 space-y-4">
        <Field label="Full name" name="fullName">
          <Input name="fullName" autoComplete="name" required />
        </Field>
        <Field label="Work email" name="email" hint={domains.length ? `Must end in ${domains.map((d) => `@${d}`).join(' or ')}` : undefined}>
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Department" name="department">
          <Select name="department" defaultValue="" required>
            <option value="" disabled>
              Select your department
            </option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Password" name="password" hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short passphrase is easier to remember and harder to guess.`}>
          <Input name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} />
        </Field>
        <Field label="Confirm password" name="confirmPassword">
          <Input name="confirmPassword" type="password" autoComplete="new-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Creating account…">
          Create account
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
