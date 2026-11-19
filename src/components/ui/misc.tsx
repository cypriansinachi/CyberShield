import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Badge({ children, className, tone = 'neutral' }: { children: ReactNode; className?: string; tone?: 'neutral' | 'primary' | 'good' | 'warning' | 'serious' | 'critical' }) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground ring-border',
    primary: 'bg-primary-soft text-primary ring-primary/20',
    good: 'bg-good-soft text-good-ink ring-good/25',
    warning: 'bg-warning-soft text-warning-ink ring-warning/30',
    serious: 'bg-serious-soft text-serious-ink ring-serious/30',
    critical: 'bg-critical-soft text-critical-ink ring-critical/25',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

const alertStyles = {
  info: { cls: 'border-primary/25 bg-primary-soft text-foreground', icon: Info, iconCls: 'text-primary' },
  success: { cls: 'border-good/30 bg-good-soft text-foreground', icon: CheckCircle2, iconCls: 'text-good-ink' },
  warning: { cls: 'border-warning/40 bg-warning-soft text-foreground', icon: AlertTriangle, iconCls: 'text-warning-ink' },
  error: { cls: 'border-critical/30 bg-critical-soft text-foreground', icon: XCircle, iconCls: 'text-critical-ink' },
};

export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof alertStyles; title?: ReactNode; children?: ReactNode; className?: string }) {
  const s = alertStyles[tone];
  const Icon = s.icon;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('animate-fade-up flex gap-3 rounded-lg border px-4 py-3 text-sm', s.cls, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', s.iconCls)} aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline">{children}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.7rem]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Stat tile: label · value · optional context line. */
export function StatTile({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'critical' | 'serious' | 'good'; icon?: ReactNode }) {
  const toneCls = tone === 'critical' ? 'text-critical-ink' : tone === 'serious' ? 'text-serious-ink' : tone === 'good' ? 'text-good-ink' : '';
  return (
    <div className="lift rounded-xl border border-border bg-card px-4 py-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      <p className={cn('font-display mt-2 text-2xl font-bold tracking-tight', toneCls)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function DescriptionList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('divide-y divide-border text-sm', className)}>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-5 gap-3 py-2.5">
          <dt className="col-span-2 text-muted-foreground">{it.label}</dt>
          <dd className="col-span-3 min-w-0 break-words">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_thead]:border-b [&_thead]:border-border [&_thead]:bg-muted/50 [&_tbody_tr]:border-b [&_tbody_tr]:border-border [&_tbody_tr:last-child]:border-0">
        {children}
      </table>
    </div>
  );
}
