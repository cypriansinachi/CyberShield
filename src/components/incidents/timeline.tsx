import {
  AlarmClock,
  ArrowRightLeft,
  CheckSquare,
  FilePlus2,
  Gauge,
  Landmark,
  Lock,
  MessageSquare,
  Paperclip,
  UserCheck,
} from 'lucide-react';
import type { IncidentDetail } from '@/server/services/incidents';
import { STATUSES, type Status } from '@/lib/workflow';
import { ROLES, type Role } from '@/lib/rbac';
import { formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

const ICONS = {
  created: FilePlus2,
  comment: MessageSquare,
  status_change: ArrowRightLeft,
  assignment: UserCheck,
  classification: Gauge,
  task: CheckSquare,
  attachment: Paperclip,
  compliance: Landmark,
  sla: AlarmClock,
} as const;

function headline(e: IncidentDetail['events'][number]) {
  const who = e.actorName ?? 'System';
  switch (e.type) {
    case 'created':
      return `${who} reported the incident`;
    case 'status_change': {
      const m = e.meta as { from?: Status; to?: Status };
      return `${who} changed status ${m.from ? `from ${STATUSES[m.from].label} ` : ''}to ${m.to ? STATUSES[m.to].label : '?'}`;
    }
    case 'comment':
      return e.visibility === 'internal' ? `${who} added an internal note` : `${who} posted a message`;
    case 'assignment':
      return `${who} updated the assignment`;
    case 'classification':
      return `${who} updated the risk classification`;
    case 'task':
      return `${who} updated a response task`;
    case 'attachment':
      return `${who} added evidence`;
    case 'compliance':
      return `${who === 'System' ? 'Compliance check' : who}: regulatory notification`;
    case 'sla':
      return 'Service-level breach escalated';
  }
}

export function Timeline({ events, staff }: { events: IncidentDetail['events']; staff: boolean }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
      {events.map((e) => {
        const Icon = ICONS[e.type] ?? MessageSquare;
        const internal = staff && e.visibility === 'internal';
        const isMessage = e.type === 'comment';
        return (
          <li key={e.id} className="relative flex gap-3">
            <span
              className={cn(
                'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card',
                e.type === 'sla' ? 'bg-critical-soft text-critical-ink' : isMessage ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm">
                <span className="font-medium">{headline(e)}</span>
                {e.actorRole && staff && <span className="text-muted-foreground"> · {ROLES[e.actorRole as Role]?.label}</span>}
                {internal && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Lock className="size-2.5" aria-hidden /> Internal
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground" title={formatDateTime(e.createdAt)}>
                {formatDateTime(e.createdAt)} · {timeAgo(e.createdAt)}
              </p>
              {e.body && (
                <div
                  className={cn(
                    'mt-2 whitespace-pre-wrap break-words text-sm',
                    isMessage ? (internal ? 'rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2' : 'rounded-lg bg-primary-soft/60 px-3 py-2') : 'text-muted-foreground',
                  )}
                >
                  {e.body}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
