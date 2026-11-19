import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, History, ShieldCheck, UserCog } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Badge, DescriptionList, PageHeader } from '@/components/ui/misc';
import { UpdateUserForm, UserSecurityAction } from '@/components/admin-forms';
import { requirePermission } from '@/server/auth/dal';
import { getUser, recentAuditForUser } from '@/server/services/users';
import { listActiveSessions } from '@/server/auth/session';
import { ROLES } from '@/lib/rbac';
import { formatDateTime, isFuture, timeAgo } from '@/lib/format';

export const metadata: Metadata = { title: 'User' };

export default async function UserDetailPage({ params }: PageProps<'/admin/users/[id]'>) {
  const admin = await requirePermission('user.manage');
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const u = await getUser(Number(id));
  if (!u) notFound();
  const isSelf = u.id === admin.id;
  const locked = isFuture(u.lockedUntil);
  const sessions = await listActiveSessions(u.id);
  const activity = await recentAuditForUser(u.id);

  return (
    <>
      <Link href="/admin/users" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Users & roles
      </Link>
      <PageHeader
        title={u.fullName}
        description={u.email}
        actions={
          <div className="flex gap-2">
            <Badge tone="primary">{ROLES[u.role].label}</Badge>
            {!u.isActive && <Badge>Deactivated</Badge>}
            {locked && <Badge tone="critical">Locked until {formatDateTime(u.lockedUntil)}</Badge>}
          </div>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Role & access" icon={<UserCog />} description={ROLES[u.role].description} />
            <CardBody>
              <UpdateUserForm user={{ id: u.id, role: u.role, department: u.department, isActive: u.isActive }} isSelf={isSelf} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent activity" icon={<History />} description="From the audit trail" />
            {activity.length ? (
              <ul className="divide-y divide-border text-xs">
                {activity.map((a) => (
                  <li key={a.id} className="grid grid-cols-[9rem_minmax(0,1fr)_auto] gap-3 px-5 py-2">
                    <span className="text-muted-foreground">{formatDateTime(a.ts)}</span>
                    <code className="truncate font-mono">{a.action}</code>
                    <span className={a.outcome === 'success' ? 'text-good-ink' : 'text-critical-ink'}>{a.outcome}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-sm text-muted-foreground">No activity recorded.</CardBody>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Account" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Department', value: u.department ?? '—' },
                  { label: 'MFA', value: u.mfaEnabled ? 'Enabled' : 'Not enabled' },
                  { label: 'Last sign-in', value: u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never' },
                  { label: 'Password set', value: u.passwordChangedAt ? timeAgo(u.passwordChangedAt) : '—' },
                  { label: 'Active sessions', value: sessions.length },
                  { label: 'Created', value: formatDateTime(u.createdAt) },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Security actions" icon={<ShieldCheck />} />
            <CardBody className="space-y-2">
              {isSelf ? (
                <Alert tone="info">Manage your own credentials from the Account page.</Alert>
              ) : (
                <>
                  {locked && <UserSecurityAction userId={u.id} op="unlock" label="Unlock account" />}
                  <UserSecurityAction userId={u.id} op="revoke_sessions" label="Sign out of all sessions" />
                  {u.mfaEnabled && <UserSecurityAction userId={u.id} op="reset_mfa" label="Reset MFA (lost device)" variant="danger-outline" />}
                  <UserSecurityAction userId={u.id} op="reset_password" label="Reset password" variant="danger-outline" />
                </>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
