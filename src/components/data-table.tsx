'use client';
/**
 * Reusable data table.
 *
 *  - mode="client": sorting, search and pagination happen in the browser
 *    (small datasets such as users or a report register).
 *  - mode="server": sorting, search and pagination are written to the URL and
 *    the page re-renders on the server, so large datasets are never sent whole.
 *
 * Both modes share the toolbar (search, density, column visibility), sortable
 * headers with aria-sort, sticky header, keyboard-accessible clickable rows and
 * numbered pagination. Display preferences persist per table in localStorage.
 * Cells arrive pre-rendered from Server Components; `values` carry the raw
 * data used for sorting and searching.
 */
import { useMemo, useState, useSyncExternalStore, useTransition, useRef, type ReactNode, type KeyboardEvent, type MouseEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Loader2, Rows3, Rows4, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Column = {
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  hideable?: boolean;
  defaultHidden?: boolean;
  className?: string;
  /** Column to fall back to on narrow screens (hidden below this breakpoint). */
  minScreen?: 'sm' | 'md' | 'lg' | 'xl';
  /** First click sorts descending (dates, scores) instead of ascending. */
  descFirst?: boolean;
};

export type Row = {
  id: string | number;
  cells: Record<string, ReactNode>;
  values?: Record<string, string | number | null | undefined>;
  href?: string;
  tone?: 'critical' | 'muted';
};

type Prefs = { density?: 'comfortable' | 'compact'; hidden?: string[] };

// ── Per-table preferences in localStorage (read via useSyncExternalStore) ──
const PREF_EVENT = 'cirp-table-prefs';
function readPrefs(id: string): string | null {
  try {
    return localStorage.getItem(`cirp.table.${id}`);
  } catch {
    return null;
  }
}
function writePrefs(id: string, prefs: Prefs) {
  try {
    localStorage.setItem(`cirp.table.${id}`, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(PREF_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(PREF_EVENT, cb);
  };
}
function usePrefs(id: string): [Prefs, (p: Prefs) => void] {
  const raw = useSyncExternalStore(subscribe, () => readPrefs(id), () => null);
  const prefs = useMemo<Prefs>(() => {
    try {
      return raw ? (JSON.parse(raw) as Prefs) : {};
    } catch {
      return {};
    }
  }, [raw]);
  return [prefs, (p) => writePrefs(id, p)];
}

const screenCls = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };
const alignCls = { left: 'text-left', right: 'text-right', center: 'text-center' };

function compare(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

function pageList(page: number, count: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, count, page - 1, page, page + 1].filter((p) => p >= 1 && p <= count));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export function DataTable({
  id,
  columns,
  rows,
  mode = 'client',
  total,
  page: serverPage = 1,
  pageSize: serverPageSize,
  sort: serverSort,
  dir: serverDir,
  query: serverQuery = '',
  searchable = true,
  searchPlaceholder = 'Search…',
  pageSizes = [10, 15, 25, 50, 100],
  defaultPageSize = 15,
  defaultSort,
  empty,
  toolbar,
  caption,
}: {
  id: string;
  columns: Column[];
  rows: Row[];
  mode?: 'client' | 'server';
  total?: number;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  query?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSizes?: number[];
  defaultPageSize?: number;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  empty?: ReactNode;
  toolbar?: ReactNode;
  caption?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [prefs, setPrefs] = usePrefs(id);
  const [menuOpen, setMenuOpen] = useState(false);

  // Client-mode state
  const [cQuery, setCQuery] = useState('');
  const [cSort, setCSort] = useState(defaultSort ?? null);
  const [cPage, setCPage] = useState(1);
  const [cSize, setCSize] = useState(defaultPageSize);
  const [draft, setDraft] = useState(serverQuery);
  const [prevQuery, setPrevQuery] = useState(serverQuery);
  if (serverQuery !== prevQuery) {
    // The URL changed elsewhere (e.g. a filter chip was removed): follow it,
    // unless it merely reflects what is already typed in the box.
    setPrevQuery(serverQuery);
    if (serverQuery !== draft.trim()) setDraft(serverQuery);
  }
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const server = mode === 'server';
  const density = prefs.density ?? 'comfortable';
  const hidden = new Set(prefs.hidden ?? columns.filter((c) => c.defaultHidden).map((c) => c.key));
  const visible = columns.filter((c) => !hidden.has(c.key));

  const navigate = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1)) next.delete(k);
      else next.set(k, String(v));
    }
    startTransition(() => router.push(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false }));
  };

  // ── Derive the visible page ──
  const sortState = server ? (serverSort ? { key: serverSort, dir: serverDir ?? 'desc' } : null) : cSort;
  let pageRows = rows;
  let totalRows = total ?? rows.length;
  let page = serverPage;
  let size = serverPageSize ?? defaultPageSize;
  if (!server) {
    const q = cQuery.trim().toLowerCase();
    let filtered = q
      ? rows.filter((r) => Object.values(r.values ?? {}).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q)))
      : rows;
    if (cSort) {
      const k = cSort.key;
      filtered = [...filtered].sort((a, b) => compare(a.values?.[k], b.values?.[k]) * (cSort.dir === 'asc' ? 1 : -1));
    }
    totalRows = filtered.length;
    size = cSize;
    const pages = Math.max(1, Math.ceil(totalRows / size));
    page = Math.min(cPage, pages);
    pageRows = filtered.slice((page - 1) * size, page * size);
  }
  const pageCount = Math.max(1, Math.ceil(totalRows / size));
  const from = totalRows ? (page - 1) * size + 1 : 0;
  const to = Math.min(page * size, totalRows);

  const toggleSort = (col: Column) => {
    const first: 'asc' | 'desc' = col.descFirst ? 'desc' : 'asc';
    const next = sortState?.key === col.key ? (sortState.dir === first ? (first === 'asc' ? 'desc' : 'asc') : null) : first;
    if (server) navigate({ sort: next ? col.key : undefined, dir: next ?? undefined, page: 1 });
    else {
      setCSort(next ? { key: col.key, dir: next } : null);
      setCPage(1);
    }
  };
  const goPage = (p: number) => (server ? navigate({ page: p }) : setCPage(p));
  const setSize = (s: number) => (server ? navigate({ size: s, page: 1 }) : (setCSize(s), setCPage(1)));
  const onSearch = (v: string) => {
    if (!server) {
      setCQuery(v);
      setCPage(1);
      return;
    }
    setDraft(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => navigate({ q: v.trim() || undefined, page: 1 }), 350);
  };

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, href?: string) => {
    if (!href || (e.target as HTMLElement).closest('a,button,input,select,summary,label')) return;
    if (e.metaKey || e.ctrlKey) window.open(href, '_blank');
    else router.push(href);
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, href?: string) => {
    if (href && e.key === 'Enter' && e.target === e.currentTarget) router.push(href);
  };

  const cellPad = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-3';
  const searchValue = server ? draft : cQuery;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        {searchable && (
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={searchValue}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-8 text-sm transition-shadow placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
            {searchValue && (
              <button type="button" onClick={() => onSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}
        {toolbar}
        <div className="ml-auto flex items-center gap-1">
          {pending && <Loader2 className="mr-1 size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
          <button
            type="button"
            onClick={() => setPrefs({ ...prefs, density: density === 'compact' ? 'comfortable' : 'compact' })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
          >
            {density === 'compact' ? <Rows3 className="size-4" /> : <Rows4 className="size-4" />}
            <span className="hidden sm:inline">{density === 'compact' ? 'Compact' : 'Comfortable'}</span>
          </button>
          {columns.some((c) => c.hideable !== false) && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Columns3 className="size-4" /> <span className="hidden sm:inline">Columns</span>
              </button>
              {menuOpen && (
                <>
                  <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close column menu" onClick={() => setMenuOpen(false)} />
                  <div className="animate-pop absolute right-0 z-20 mt-1 w-52 rounded-xl border border-border bg-card p-1.5 shadow-lg">
                    <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Show columns</p>
                    {columns
                      .filter((c) => c.hideable !== false)
                      .map((c) => (
                        <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                          <input
                            type="checkbox"
                            className="size-3.5 accent-[var(--primary)]"
                            checked={!hidden.has(c.key)}
                            onChange={(e) => {
                              const next = new Set(hidden);
                              if (e.target.checked) next.delete(c.key);
                              else next.add(c.key);
                              setPrefs({ ...prefs, hidden: [...next] });
                            }}
                          />
                          {c.header}
                        </label>
                      ))}
                    <button type="button" onClick={() => setPrefs({})} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-primary hover:bg-muted">
                      Reset to default
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={cn('max-h-[70vh] overflow-auto transition-opacity duration-200', pending && 'opacity-60')}>
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-[1]">
            <tr>
              {visible.map((c) => {
                const active = sortState?.key === c.key;
                const Icon = active ? (sortState!.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sortState!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'whitespace-nowrap border-b border-border bg-muted/80 text-xs font-medium text-muted-foreground backdrop-blur',
                      density === 'compact' ? 'px-3 py-2' : 'px-4 py-2.5',
                      alignCls[c.align ?? 'left'],
                      c.minScreen && screenCls[c.minScreen],
                    )}
                  >
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c)}
                        className={cn('group inline-flex items-center gap-1 rounded transition-colors hover:text-foreground', active && 'text-foreground')}
                      >
                        {c.header}
                        <Icon className={cn('size-3.5 transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} aria-hidden />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody key={`${page}:${sortState?.key}:${sortState?.dir}:${server ? serverQuery : cQuery}`} className="stagger">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={visible.length} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {empty ?? 'No matching records.'}
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <tr
                  key={r.id}
                  onClick={(e) => onRowClick(e, r.href)}
                  onKeyDown={(e) => onRowKey(e, r.href)}
                  tabIndex={r.href ? 0 : undefined}
                  className={cn(
                    'group transition-colors',
                    r.href && 'cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none',
                    r.tone === 'critical' && 'bg-critical-soft/30',
                    r.tone === 'muted' && 'opacity-70',
                  )}
                >
                  {visible.map((c) => (
                    <td
                      key={c.key}
                      className={cn('border-b border-border align-middle', cellPad, alignCls[c.align ?? 'left'], c.minScreen && screenCls[c.minScreen], c.className)}
                    >
                      {r.cells[c.key] ?? <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span aria-live="polite">
            {totalRows ? (
              <>
                Showing <strong className="font-medium text-foreground">{from.toLocaleString('en')}–{to.toLocaleString('en')}</strong> of{' '}
                <strong className="font-medium text-foreground">{totalRows.toLocaleString('en')}</strong>
              </>
            ) : (
              'No results'
            )}
          </span>
          <label className="flex items-center gap-1.5">
            Rows
            <select
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="h-7 rounded-md border border-input bg-card px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              {pageSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <PagerButton disabled={page <= 1} onClick={() => goPage(page - 1)} label="Previous page">
            <ChevronLeft className="size-4" />
          </PagerButton>
          {pageList(page, pageCount).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="px-1">
                …
              </span>
            ) : (
              <PagerButton key={p} active={p === page} onClick={() => goPage(p)} label={`Page ${p}`}>
                {p}
              </PagerButton>
            ),
          )}
          <PagerButton disabled={page >= pageCount} onClick={() => goPage(page + 1)} label="Next page">
            <ChevronRight className="size-4" />
          </PagerButton>
        </nav>
      </div>
    </div>
  );
}

function PagerButton({ children, onClick, disabled, active, label }: { children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-medium tabular-nums transition-all',
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-muted',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {children}
    </button>
  );
}
