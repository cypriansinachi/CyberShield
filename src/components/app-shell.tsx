'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  ClipboardList,
  FileBarChart2,
  LayoutDashboard,
  LogOut,
  Menu,
  PlusCircle,
  ScrollText,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { buttonClass } from './ui/button';
import { Logo } from './logo';
import { ThemeSelect, ThemeToggle, type ThemeChoice } from './theme-toggle';
import { cn, initials } from '@/lib/utils';

const ICONS = {
  dashboard: LayoutDashboard,
  report: PlusCircle,
  list: ClipboardList,
  reports: FileBarChart2,
  compliance: ShieldCheck,
  audit: ScrollText,
  users: Users,
  account: UserCog,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };
export type NavSection = { title: string; items: NavItem[] };

/** Inline spinner shown on the clicked nav link while the next page renders. */
function NavPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn('ml-auto size-3.5 rounded-full border-2 border-blue-400/30 border-t-blue-400 transition-opacity', pending ? 'animate-spin opacity-100' : 'opacity-0')}
    />
  );
}

function isActive(pathname: string, href: string) {
  if (href === '/incidents') return pathname === '/incidents' || (/^\/incidents\/\d+/.test(pathname));
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarContent({ nav, orgName, onNavigate }: { nav: NavSection[]; orgName: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <Logo />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-white">CIRP</p>
          <p className="truncate text-[11px] text-sidebar-muted">{orgName}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Main">
        {nav.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">{section.title}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 hover:translate-x-0.5',
                        active ? 'bg-sidebar-accent font-medium text-white' : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white',
                      )}
                    >
                      <Icon className={cn('size-4', active ? 'text-blue-400' : 'text-sidebar-muted')} aria-hidden />
                      {item.label}
                      <NavPending />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border px-5 py-4 text-[11px] leading-relaxed text-sidebar-muted">
        Report suspected incidents immediately. Do not investigate or contact attackers yourself.
      </div>
    </div>
  );
}

function NotificationBell({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    // A server re-render brought a fresh count: adopt it (React's "adjust state on prop change" pattern).
    setPrevInitial(initial);
    setCount(initial);
  }
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/notifications/unread', { cache: 'no-store' });
        if (res.ok) setCount((await res.json()).count);
      } catch {
        /* offline: keep last value */
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Link href="/notifications" className={buttonClass({ variant: 'ghost', size: 'icon', className: 'relative' })} aria-label={`Notifications (${count} unread)`}>
      <Bell aria-hidden />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full animate-pulse-ring bg-critical px-1 text-[10px] font-semibold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

export function AppShell({
  nav,
  user,
  unread,
  theme,
  orgName,
  canSearch,
  canReport,
  logoutAction,
  children,
}: {
  nav: NavSection[];
  user: { fullName: string; email: string; roleLabel: string };
  unread: number;
  theme: ThemeChoice;
  orgName: string;
  canSearch: boolean;
  canReport: boolean;
  logoutAction: () => Promise<void>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-sidebar lg:block">
        <SidebarContent nav={nav} orgName={orgName} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-[2px]" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="animate-drawer absolute inset-y-0 left-0 w-72 bg-sidebar shadow-xl">
            <button className="absolute right-3 top-4 rounded-md p-1.5 text-sidebar-foreground hover:bg-sidebar-accent" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <SidebarContent nav={nav} orgName={orgName} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur sm:px-6">
          <button className={buttonClass({ variant: 'ghost', size: 'icon', className: 'lg:hidden' })} onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu aria-hidden />
          </button>

          {canSearch ? (
            <form action="/incidents" method="get" className="relative hidden max-w-md flex-1 sm:block" role="search">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                name="q"
                placeholder="Search incidents by reference, title or details…"
                aria-label="Search incidents"
                className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </form>
          ) : (
            <div className="flex-1" />
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {canReport && (
              <Link href="/incidents/new" className={buttonClass({ size: 'sm', className: 'hidden sm:inline-flex' })}>
                <PlusCircle aria-hidden /> Report incident
              </Link>
            )}
            <ThemeToggle />
            <NotificationBell initial={unread} />
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted [&::-webkit-details-marker]:hidden">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials(user.fullName)}</span>
                <span className="hidden text-left md:block">
                  <span className="block text-sm font-medium leading-4">{user.fullName}</span>
                  <span className="block text-[11px] text-muted-foreground">{user.roleLabel}</span>
                </span>
              </summary>
              <div className="animate-pop absolute right-0 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-lg">
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-medium">{user.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
                <div className="px-2 pb-2">
                  <ThemeSelect initial={theme} />
                </div>
                <div className="my-1 h-px bg-border" />
                <Link href="/account" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted">
                  <UserCog className="size-4 text-muted-foreground" aria-hidden /> Account & security
                </Link>
                <form action={logoutAction}>
                  <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                    <LogOut className="size-4 text-muted-foreground" aria-hidden /> Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main key={pathname} className="animate-page mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
