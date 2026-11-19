'use client';
/** Filter controls that write straight to the URL (server re-renders the results). */
import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

function useUrlUpdate() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    start(() => router.push(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false }));
  };
  return { params, update, pending };
}

export function UrlSelect({ name, label, options }: { name: string; label: string; options: { value: string; label: string }[] }) {
  const { params, update, pending } = useUrlUpdate();
  const value = params.get(name) ?? '';
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => update({ [name]: e.target.value || undefined })}
      className={cn(
        'h-9 rounded-lg border bg-card px-2.5 pr-7 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40',
        value ? 'border-primary/50 text-foreground' : 'border-input text-muted-foreground',
        pending && 'opacity-70',
      )}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Removable chips for every active filter, plus "Clear all". */
export function ActiveFilters({ labels }: { labels: Record<string, Record<string, string> | 'text'> }) {
  const { params, update } = useUrlUpdate();
  const active = Object.keys(labels).filter((k) => params.get(k));
  if (!active.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
      <span className="text-xs text-muted-foreground">Filtered by</span>
      {active.map((k) => {
        const v = params.get(k)!;
        const map = labels[k];
        const text = map === 'text' ? `“${v}”` : (map[v] ?? v);
        return (
          <button
            key={k}
            type="button"
            onClick={() => update({ [k]: undefined })}
            className="animate-fade-in inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary-soft/70"
          >
            {text}
            <X className="size-3" aria-label={`Remove filter ${text}`} />
          </button>
        );
      })}
      <button type="button" onClick={() => update(Object.fromEntries(active.map((k) => [k, undefined])))} className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Clear all
      </button>
    </div>
  );
}
