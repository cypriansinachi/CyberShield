import { cookies } from 'next/headers';
import { AppShell, type NavSection } from '@/components/app-shell';
import { requireUser } from '@/server/auth/dal';
import { unreadCount } from '@/server/services/notifications';
import { logoutAction } from '@/server/actions/auth';
import { can, ROLES } from '@/lib/rbac';
import { ORG_NAME } from '@/lib/constants';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  // Each page re-checks access itself; the layout only needs the user for the chrome.
  const user = await requireUser({ allowPendingSetup: true });
  const staff = can(user, 'incident.view_all');
  const stored = (await cookies()).get('cirp_theme')?.value;
  const theme = stored === 'light' || stored === 'dark' ? stored : 'system';

  const nav: NavSection[] = [
    { title: 'Overview', items: [{ href: '/dashboard', label: can(user, 'dashboard.view') ? 'Security dashboard' : 'Home', icon: 'dashboard' }] },
    {
      title: 'Incidents',
      items: [
        ...(can(user, 'incident.create') ? [{ href: '/incidents/new', label: 'Report an incident', icon: 'report' as const }] : []),
        { href: '/incidents', label: staff ? 'All incidents' : 'My reports', icon: 'list' },
      ],
    },
    {
      title: 'Governance',
      items: [
        ...(can(user, 'report.view') ? [{ href: '/reports', label: 'Reports', icon: 'reports' as const }] : []),
        ...(can(user, 'compliance.view') ? [{ href: '/compliance', label: 'Compliance', icon: 'compliance' as const }] : []),
        ...(can(user, 'audit.view') ? [{ href: '/audit', label: 'Audit log', icon: 'audit' as const }] : []),
      ],
    },
    {
      title: 'Administration',
      items: [
        ...(can(user, 'user.manage') ? [{ href: '/admin/users', label: 'Users & roles', icon: 'users' as const }] : []),
        { href: '/account', label: 'Account & security', icon: 'account' },
      ],
    },
  ].filter((s) => s.items.length > 0) as NavSection[];

  return (
    <AppShell
      nav={nav}
      user={{ fullName: user.fullName, email: user.email, roleLabel: ROLES[user.role].label }}
      unread={await unreadCount(user.id)}
      theme={theme}
      orgName={ORG_NAME}
      canSearch={staff}
      canReport={can(user, 'incident.create')}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
