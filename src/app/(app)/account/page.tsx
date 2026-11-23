import type { Metadata } from 'next';
import { KeyRound, Laptop, Lock, User } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Badge, DescriptionList, PageHeader } from '@/components/ui/misc';
import { ChangePasswordForm, DisableMfaForm, MfaSetup, SignOutOthersForm } from '@/components/admin-forms';
import { requireUser } from '@/server/auth/dal';
import { listActiveSessions } from '@/server/auth/session';
import { ROLES } from '@/lib/rbac';
import { formatDateTime, timeAgo } from '@/lib/format';
import { ORG_NAME } from '@/lib/constants';

export const metadata: Metadata = { title: 'Account & security' };

function deviceLabel(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export default async function AccountPage({ searchParams }: PageProps<'/account'>) {
  const user = await requireUser({ allowPendingSetup: true });
  const sp = await searchParams;
  const sessions = await listActiveSessions(user.id);

  return (
    <>
      <PageHeader title="Account & security" description="Manage your password, two-step verification and signed-in devices." />

      {(sp.required === 'password' || user.mustChangePassword) && (
        <Alert tone="warning" title="Choose a new password to continue" className="mb-6">
          Your password was set by an administrator. Change it now; you cannot use the platform until you do.
        </Alert>
      )}
      {sp.required === 'mfa' && !user.mfaEnabled && (
        <Alert tone="warning" title="Two-step verification is required for your role" className="mb-6">
          {ORG_NAME} requires two-step verification for security-team accounts. Set it up below to continue.
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Change password" icon={<Lock />} description="Changing your password signs you out everywhere else." />
            <CardBody>
              <ChangePasswordForm />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Two-step verification (MFA)"
              icon={<KeyRound />}
              description="Protect your account with a time-based code from an authenticator app."
              action={user.mfaEnabled ? <Badge tone="good">Enabled</Badge> : <Badge tone="warning">Not enabled</Badge>}
            />
            <CardBody>{user.mfaEnabled ? <DisableMfaForm /> : <MfaSetup />}</CardBody>
          </Card>

          <Card>
            <CardHeader title="Active sessions" icon={<Laptop />} description="Sessions expire after 30 minutes of inactivity or 8 hours in total." action={<SignOutOthersForm />} />
            <ul className="divide-y divide-border">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {deviceLabel(s.userAgent)} {s.id === user.sessionId && <Badge tone="primary" className="ml-1">This device</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.ip ?? 'Unknown IP'} · signed in {formatDateTime(s.createdAt)} · active {timeAgo(s.lastSeenAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card>
          <CardHeader title="Profile" icon={<User />} />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Name', value: user.fullName },
                { label: 'Email', value: user.email },
                { label: 'Role', value: ROLES[user.role].label },
                ...(user.department ? [{ label: 'Department', value: user.department }] : []),
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">{ROLES[user.role].description} Contact an administrator to change your role.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
