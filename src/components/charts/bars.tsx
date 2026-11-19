import Link from 'next/link';
import { SEVERITIES, type Severity } from '@/lib/risk';
import { severityDotClass } from '@/components/incidents/badges';
import { cn } from '@/lib/utils';

/** Ranked horizontal bars: one hue, largest first, value at the tip. */
export function RankedBars({ items, href, empty = 'No data yet.' }: { items: { key: string; label: string; count: number }[]; href?: (key: string) => string; empty?: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const row = (
          <>
            <span className="truncate text-sm" title={item.label}>
              {item.label}
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 flex-1 overflow-hidden" aria-hidden>
                <span className="bar-grow block h-full rounded-r-[4px] bg-chart-1" style={{ width: `${(item.count / max) * 100}%`, minWidth: item.count ? 4 : 0 }} />
              </span>
              <span className="w-7 text-right text-xs font-medium tabular-nums">{item.count}</span>
            </span>
          </>
        );
        return (
          <li key={item.key}>
            {href ? (
              <Link href={href(item.key)} className="grid grid-cols-[minmax(0,9.5rem)_1fr] items-center gap-3 rounded-md hover:bg-muted/60" title={`${item.label}: ${item.count}`}>
                {row}
              </Link>
            ) : (
              <div className="grid grid-cols-[minmax(0,9.5rem)_1fr] items-center gap-3" title={`${item.label}: ${item.count}`}>
                {row}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One whole split into severity parts: segmented bar + legend with counts. */
export function SeveritySplit({ counts }: { counts: Record<Severity, number> }) {
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  const total = order.reduce((a, s) => a + counts[s], 0);
  return (
    <div>
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-md bg-muted" role="img" aria-label={order.map((s) => `${SEVERITIES[s].label} ${counts[s]}`).join(', ')}>
        {total > 0 &&
          order
            .filter((s) => counts[s] > 0)
            .map((s) => {
              const pct = (counts[s] / total) * 100;
              return (
                <div
                  key={s}
                  className={cn('bar-grow flex h-full items-center justify-center text-xs font-semibold', severityDotClass(s), s === 'medium' ? 'text-[#0b0b0b]' : 'text-white')}
                  style={{ width: `${pct}%` }}
                  title={`${SEVERITIES[s].label}: ${counts[s]}`}
                >
                  {pct >= 12 ? counts[s] : ''}
                </div>
              );
            })}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {order.map((s) => (
          <li key={s}>
            <Link href={`/incidents?status=open&severity=${s}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/60">
              <span className={cn('size-2.5 rounded-sm', severityDotClass(s))} aria-hidden />
              <span className="text-muted-foreground">{SEVERITIES[s].label}</span>
              <span className="ml-auto font-medium tabular-nums">{counts[s]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
