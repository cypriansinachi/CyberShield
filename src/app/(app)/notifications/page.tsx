import type { Metadata } from 'next';
import { Bell, CheckCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import { requireUser } from '@/server/auth/dal';
import { listNotifications } from '@/server/services/notifications';
import { markAllReadAction } from '@/server/actions/admin';
import { formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await listNotifications(user.id, 100);
  const unread = items.filter((n) => !n.isRead).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : 'You are all caught up.'}
        actions={
          unread > 0 && (
            <form action={markAllReadAction}>
              <button className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                <CheckCheck aria-hidden /> Mark all as read
              </button>
            </form>
          )
        }
      />
      <Card>
        {items.length ? (
          <ul className="divide-y divide-border">
            {items.map((n) => (
              <li key={n.id}>
                <a href={`/api/notifications/${n.id}`} className={cn('flex items-start gap-3 px-5 py-3.5 hover:bg-muted/40', !n.isRead && 'bg-primary-soft/40')}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-primary')} aria-label={n.isRead ? undefined : 'Unread'} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', !n.isRead && 'font-medium')}>{n.message}</span>
                    <span className="text-xs text-muted-foreground" title={formatDateTime(n.createdAt)}>
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Bell />} title="No notifications yet">
            You will be notified about assignments, status changes and replies.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
