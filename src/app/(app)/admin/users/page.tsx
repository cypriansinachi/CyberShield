import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge, PageHeader } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import { DataTable, type Column, type Row } from '@/components/data-table';
import { requirePermission } from '@/server/auth/dal';
import { listUsers } from '@/server/services/users';
import { ROLE_KEYS, ROLES } from '@/lib/rbac';
import { formatDateTime, isFuture, timeAgo } from '@/lib/format';
import { initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Users & roles' };

export default async function UsersPage({ searchParams }: PageProps<'/admin/users'>) {
  await requirePermission('user.manage');
  const sp = await searchParams;
  const role = typeof sp.role === 'string' && (ROLE_KEYS as string[]).includes(sp.role) ? sp.role : undefined;
  const everyone = await listUsers();
  const users = role ? everyone.filter((u) => u.role === role) : everyone;
  const counts = Object.fromEntries(ROLE_KEYS.map((r) => [r, everyone.filter((u) => u.role === r).length]));

  const columns: Column[] = [
    { key: 'name', header: 'User', sortable: true, hideable: false },
    { key: 'role', header: 'Role', sortable: true },
    { key: 'department', header: 'Department', sortable: true, minScreen: 'md' },
    { key: 'status', header: 'Status', sortable: true },
    { key: 'mfa', header: 'MFA', sortable: true },
    { key: 'lastLogin', header: 'Last sign-in', sortable: true, descFirst: true, minScreen: 'md' },
  ];

  const rows: Row[] = users.map((u) => {
    const locked = isFuture(u.lockedUntil);
    const status = !u.isActive ? 'Deactivated' : locked ? 'Locked' : u.mustChangePassword ? 'Password reset' : 'Active';
    return {
      id: u.id,
      href: `/admin/users/${u.id}`,
      tone: !u.isActive ? 'muted' : undefined,
      values: { name: u.fullName, email: u.email, role: ROLES[u.role].label, department: u.department, status, mfa: u.mfaEnabled ? 'on' : 'off', lastLogin: u.lastLoginAt ?? '' },
      cells: {
        name: (
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials(u.fullName)}</span>
            <div className="min-w-0">
              <Link href={`/admin/users/${u.id}`} className="block truncate font-medium transition-colors group-hover:text-primary">
                {u.fullName}
              </Link>
              <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
            </div>
          </div>
        ),
        role: <span className="text-sm">{ROLES[u.role].label}</span>,
        department: <span className="text-sm">{u.department ?? '—'}</span>,
        status: <Badge tone={status === 'Active' ? 'good' : status === 'Locked' ? 'critical' : status === 'Password reset' ? 'warning' : 'neutral'}>{status}</Badge>,
        mfa: u.mfaEnabled ? (
          <Badge tone="primary">
            <KeyRound className="size-3" aria-hidden /> On
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Off</span>
        ),
        lastLogin: (
          <span className="text-xs text-muted-foreground" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>
            {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}
          </span>
        ),
      },
    };
  });

  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Everyone starts as a Customer; only an administrator gives roles. Role changes and deactivations take effect immediately and are audited."
        actions={
          <Link href="/admin/users/new" className={buttonClass({ size: 'sm' })}>
            <UserPlus aria-hidden /> Add user
          </Link>
        }
      />

      <div className="stagger mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {ROLE_KEYS.map((r) => (
          <Link
            key={r}
            href={role === r ? '/admin/users' : `/admin/users?role=${r}`}
            className={`lift rounded-xl border bg-card p-3 text-xs shadow-xs ${role === r ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
          >
            <p className="flex items-center justify-between font-medium text-foreground">
              {ROLES[r].label}
              <span className="font-display text-base font-bold tabular-nums">{counts[r]}</span>
            </p>
            <p className="mt-1 text-muted-foreground">{ROLES[r].description}</p>
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        <DataTable
          id="users"
          caption="User accounts"
          columns={columns}
          rows={rows}
          defaultSort={{ key: 'name', dir: 'asc' }}
          searchPlaceholder="Search name, email, department…"
          empty="No users match."
          toolbar={
            role && (
              <Link href="/admin/users" className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary-soft/70">
                {ROLES[role as keyof typeof ROLES].label} ✕
              </Link>
            )
          }
        />
      </Card>
    </>
  );
}
