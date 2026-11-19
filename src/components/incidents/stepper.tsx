import { Check, XCircle } from 'lucide-react';
import { LIFECYCLE, STATUSES, type Status } from '@/lib/workflow';
import { cn } from '@/lib/utils';

/** Visual position in the NIST SP 800-61 lifecycle. */
export function WorkflowStepper({ status }: { status: Status }) {
  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <XCircle className="size-4" aria-hidden /> This report was reviewed and closed as not being a security incident (false positive or duplicate).
      </div>
    );
  }
  const current = LIFECYCLE.indexOf(status);
  return (
    <ol className="flex overflow-x-auto rounded-xl border border-border bg-card px-2 py-3" aria-label="Response progress">
      {LIFECYCLE.map((s, i) => {
        const done = i < current || status === 'closed';
        const active = i === current && status !== 'closed';
        return (
          <li key={s} className="flex min-w-[6.5rem] flex-1 items-center" aria-current={active ? 'step' : undefined}>
            <div className="flex flex-1 flex-col items-center gap-1.5 px-1 text-center">
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                  done && 'bg-primary text-primary-foreground',
                  active && 'bg-primary-soft text-primary ring-2 ring-primary',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn('text-[11px] leading-tight', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{STATUSES[s].label}</span>
            </div>
            {i < LIFECYCLE.length - 1 && <span className={cn('mb-5 h-px w-full min-w-3 flex-1', i < current ? 'bg-primary' : 'bg-border')} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
