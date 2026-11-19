'use client';

import { useActionState, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { ActionForm, Field, FormMessage, FormStateProvider, Input, Select, SubmitButton, useFormResult } from '@/components/ui/form';
import { Alert } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { createUserAction, updateUserAction, userSecurityAction } from '@/server/actions/admin';
import { beginMfaAction, changePasswordAction, confirmMfaAction, disableMfaAction, signOutOtherSessionsAction } from '@/server/actions/account';
import { idleState } from '@/lib/action-state';
import { ROLE_KEYS, ROLES, type Role } from '@/lib/rbac';
import { DEPARTMENTS } from '@/lib/constants';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Copy aria-hidden /> {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function TempPassword({ value, email }: { value: string; email?: string }) {
  return (
    <Alert tone="warning" title="One-time temporary password" className="mt-3">
      <p>
        Share this securely with {email ?? 'the user'} (not by email). It is shown only once and must be changed at first sign-in.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="rounded-md bg-card px-2 py-1 font-mono text-sm text-foreground">{value}</code>
        <CopyButton value={value} />
      </div>
    </Alert>
  );
}

function TempPasswordFromState() {
  const { state } = useFormResult();
  const temp = state.status === 'success' ? state.data?.tempPassword : undefined;
  return typeof temp === 'string' ? <TempPassword value={temp} /> : null;
}

// ───────────────────────────── Admin ─────────────────────────────

export function CreateUserForm() {
  // Remounting with a new key gives a fresh, empty form for the next user.
  const [round, setRound] = useState(0);
  return <CreateUserFormInner key={round} onAnother={() => setRound((r) => r + 1)} />;
}

function CreateUserFormInner({ onAnother }: { onAnother: () => void }) {
  const [state, formAction, pending] = useActionState(createUserAction, idleState);
  const created = state.status === 'success' && typeof state.data?.tempPassword === 'string';
  return (
    <FormStateProvider state={state} pending={pending}>
      {created ? (
        <div>
          <Alert tone="success" title={state.message} />
          <TempPassword value={String(state.data!.tempPassword)} email={String(state.data!.email)} />
          <div className="mt-4 flex gap-2">
            <Link href={`/admin/users/${state.data!.userId}`} className="text-sm font-medium text-primary hover:underline">
              View account
            </Link>
            <span className="text-muted-foreground">·</span>
            <button type="button" onClick={onAnother} className="text-sm font-medium text-primary hover:underline">
              Add another user
            </button>
          </div>
        </div>
      ) : (
        <form action={formAction} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" name="fullName">
              <Input name="fullName" />
            </Field>
            <Field label="Email address" name="email">
              <Input name="email" type="email" />
            </Field>
            <Field label="Department" name="department">
              <Select name="department" defaultValue="">
                <option value="" disabled>
                  Select…
                </option>
                {DEPARTMENTS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
            <Field label="Role" name="role">
              <Select name="role" defaultValue="reporter">
                {ROLE_KEYS.map((r) => (
                  <option key={r} value={r}>
                    {ROLES[r].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <FormMessage />
          <SubmitButton pendingText="Creating…">Create account</SubmitButton>
        </form>
      )}
    </FormStateProvider>
  );
}

export function UpdateUserForm({ user, isSelf }: { user: { id: number; role: Role; department: string | null; isActive: boolean }; isSelf: boolean }) {
  return (
    <ActionForm action={updateUserAction} resetOnSuccess={false} className="space-y-4">
      <input type="hidden" name="userId" value={user.id} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Role" name="role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
          <Select name="role" defaultValue={user.role} disabled={isSelf}>
            {ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {ROLES[r].label}
              </option>
            ))}
          </Select>
          {isSelf && <input type="hidden" name="role" value={user.role} />}
        </Field>
        <Field label="Department" name="department">
          <Select name="department" defaultValue={user.department ?? 'Other'}>
            {DEPARTMENTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field label="Account status" name="isActive">
          <Select name="isActive" defaultValue={String(user.isActive)} disabled={isSelf}>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
          </Select>
          {isSelf && <input type="hidden" name="isActive" value="true" />}
        </Field>
      </div>
      <SubmitButton variant="secondary" size="sm">
        Save changes
      </SubmitButton>
    </ActionForm>
  );
}

export function UserSecurityAction({ userId, op, label, variant = 'secondary' }: { userId: number; op: string; label: string; variant?: 'secondary' | 'danger-outline' }) {
  return (
    <ActionForm action={userSecurityAction} className="w-full">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant={variant} size="sm" className="w-full justify-start">
        {label}
      </SubmitButton>
      <TempPasswordFromState />
    </ActionForm>
  );
}

// ───────────────────────────── Account ─────────────────────────────

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="space-y-4">
      <Field label="Current password" name="currentPassword">
        <Input name="currentPassword" type="password" autoComplete="current-password" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" name="newPassword" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
          <Input name="newPassword" type="password" autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" name="confirmPassword">
          <Input name="confirmPassword" type="password" autoComplete="new-password" />
        </Field>
      </div>
      <SubmitButton size="sm" pendingText="Updating…">
        Change password
      </SubmitButton>
    </ActionForm>
  );
}

export function MfaSetup() {
  const [begin, beginAction, beginPending] = useActionState(beginMfaAction, idleState);
  const [confirm, confirmAction, confirmPending] = useActionState(confirmMfaAction, idleState);
  const data = (confirm.status === 'error' && confirm.data) || (begin.status === 'success' && begin.data) || null;

  if (confirm.status === 'success') return <Alert tone="success" title={confirm.message} />;
  if (!data) {
    return (
      <form action={beginAction}>
        {begin.status === 'error' && <Alert tone="error" className="mb-3">{begin.message}</Alert>}
        <Button type="submit" disabled={beginPending}>
          <KeyRound aria-hidden /> Set up authenticator app
        </Button>
      </form>
    );
  }
  return (
    <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
      <div className="rounded-xl border border-border bg-white p-2">
        <Image src={String(data.qrDataUrl)} alt="QR code for your authenticator app" width={176} height={176} unoptimized />
      </div>
      <div className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>Open Google Authenticator, Microsoft Authenticator or a similar app.</li>
          <li>Scan the QR code, or enter the key below manually.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{String(data.secret)}</code>
          <CopyButton value={String(data.secret)} />
        </div>
        <FormStateProvider state={confirm} pending={confirmPending}>
          <form action={confirmAction} className="flex flex-wrap items-start gap-2" noValidate>
            <input type="hidden" name="secret" value={String(data.secret)} />
            <input type="hidden" name="qrDataUrl" value={String(data.qrDataUrl)} />
            <Input name="code" inputMode="numeric" maxLength={6} placeholder="123456" aria-label="Authentication code" className="w-32 text-center font-mono tracking-widest" />
            <SubmitButton pendingText="Verifying…">
              <ShieldCheck aria-hidden /> Verify & enable
            </SubmitButton>
            <FormMessage className="w-full" />
          </form>
        </FormStateProvider>
      </div>
    </div>
  );
}

export function DisableMfaForm() {
  return (
    <ActionForm action={disableMfaAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
      <Field label="Password" name="password">
        <Input name="password" type="password" autoComplete="current-password" />
      </Field>
      <Field label="Current code" name="code">
        <Input name="code" inputMode="numeric" maxLength={6} className="font-mono" />
      </Field>
      <SubmitButton variant="danger-outline">Turn off MFA</SubmitButton>
    </ActionForm>
  );
}

export function SignOutOthersForm() {
  return (
    <ActionForm action={signOutOtherSessionsAction}>
      <SubmitButton size="sm" variant="secondary">
        Sign out all other sessions
      </SubmitButton>
    </ActionForm>
  );
}
