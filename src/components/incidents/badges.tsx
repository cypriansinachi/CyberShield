import { AlertOctagon, CheckCircle2, Clock, TimerOff, AlertTriangle, MinusCircle } from 'lucide-react';
import { SEVERITIES, type Severity } from '@/lib/risk';
import { STATUSES, type SlaState, type Status } from '@/lib/workflow';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

const sevStyles: Record<Severity, { pill: string; dot: string }> = {
  critical: { pill: 'bg-critical-soft text-critical-ink ring-critical/25', dot: 'bg-critical' },
  high: { pill: 'bg-serious-soft text-serious-ink ring-serious/30', dot: 'bg-serious' },
  medium: { pill: 'bg-warning-soft text-warning-ink ring-warning/30', dot: 'bg-warning' },
  low: { pill: 'bg-good-soft text-good-ink ring-good/25', dot: 'bg-good' },
};

/** Severity always shows as dot + text label, never colour alone. */
export function SeverityBadge({ severity, className, showPriority }: { severity: Severity; className?: string; showPriority?: boolean }) {
  const s = sevStyles[severity];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.pill, className)}>
      <span className={cn('size-1.5 rounded-full', s.dot)} aria-hidden />
      {SEVERITIES[severity].label}
      {showPriority && <span className="opacity-70">· {SEVERITIES[severity].priority}</span>}
    </span>
  );
}

export const severityDotClass = (s: Severity) => sevStyles[s].dot;

const statusStyles: Record<Status, string> = {
  new: 'bg-primary-soft text-primary ring-primary/20',
  triaged: 'bg-primary-soft text-primary ring-primary/20',
  investigating: 'bg-warning-soft text-warning-ink ring-warning/30',
  contained: 'bg-serious-soft text-serious-ink ring-serious/25',
  eradicated: 'bg-serious-soft text-serious-ink ring-serious/25',
  recovered: 'bg-good-soft text-good-ink ring-good/25',
  closed: 'bg-muted text-muted-foreground ring-border',
  rejected: 'bg-muted text-muted-foreground ring-border line-through decoration-1',
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', statusStyles[status], className)}>
      {STATUSES[status].label}
    </span>
  );
}

const slaMap: Record<SlaState, { label: string; cls: string; Icon: typeof Clock }> = {
  on_track: { label: 'On track', cls: 'text-muted-foreground', Icon: Clock },
  at_risk: { label: 'At risk', cls: 'text-warning-ink', Icon: AlertTriangle },
  overdue: { label: 'Overdue', cls: 'text-critical-ink font-medium', Icon: AlertOctagon },
  pending: { label: 'Awaiting', cls: 'text-muted-foreground', Icon: Clock },
  met: { label: 'Met', cls: 'text-good-ink', Icon: CheckCircle2 },
  missed: { label: 'Missed', cls: 'text-critical-ink', Icon: TimerOff },
  'n/a': { label: 'N/A', cls: 'text-muted-foreground', Icon: MinusCircle },
};

export function SlaIndicator({ state, remainingMs, className }: { state: SlaState; remainingMs?: number; className?: string }) {
  const s = slaMap[state];
  const extra =
    remainingMs !== undefined && (state === 'on_track' || state === 'at_risk')
      ? ` · ${formatDuration(remainingMs)} left`
      : remainingMs !== undefined && state === 'overdue'
        ? ` · ${formatDuration(remainingMs)} late`
        : '';
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs', s.cls, className)}>
      <s.Icon className="size-3.5" aria-hidden />
      {s.label}
      {extra}
    </span>
  );
}

export function RiskMeter({ score, severity, className }: { score: number; severity: Severity; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)} title={`Risk score ${score} / 100`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('bar-grow h-full rounded-full', severityDotClass(severity))} style={{ width: `${Math.max(4, score)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{score}</span>
    </div>
  );
}
