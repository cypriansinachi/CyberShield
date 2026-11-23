import { redirect } from 'next/navigation';
import { ClipboardCheck, FileLock2, Gauge, ScrollText } from 'lucide-react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { getCurrentUser } from '@/server/auth/dal';
import { APP_NAME, APP_TAGLINE, ORG_NAME } from '@/lib/constants';

const FEATURES = [
  { icon: ClipboardCheck, title: 'Structured reporting', text: `Any ${ORG_NAME} customer can report a problem they notice, with screenshots or other evidence.` },
  { icon: Gauge, title: 'Explainable risk scoring', text: 'Automatic severity and priority, with the reasons shown to every responder.' },
  { icon: FileLock2, title: 'Secure by design', text: 'MFA, role-based access and encrypted evidence, with every request checked on the server.' },
  { icon: ScrollText, title: 'Audit-ready', text: 'Tamper-evident audit trail, SLA tracking and breach-notification deadlines.' },
];

export default async function AuthLayout({ children }: LayoutProps<'/'>) {
  if (await getCurrentUser()) redirect('/dashboard');
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(60rem_40rem_at_-10%_-10%,rgba(59,130,246,0.25),transparent_60%),radial-gradient(40rem_30rem_at_110%_110%,rgba(99,102,241,0.2),transparent_60%)]" aria-hidden />
        <div className="relative flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-semibold text-white">{APP_NAME}</p>
            <p className="text-xs text-sidebar-muted">{APP_TAGLINE}</p>
          </div>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">Seen something suspicious on {ORG_NAME}? Report it to {APP_NAME}.</h1>
          <p className="mt-3 text-sm leading-relaxed text-sidebar-muted">
            {APP_NAME} is where {ORG_NAME} customers report the security problems they notice, from fake {ORG_NAME} emails to unexpected account activity. {ORG_NAME}&apos;s security team classifies, tracks and resolves every report, with the accountability and evidence that auditors and regulators expect.
          </p>
          <ul className="stagger mt-10 grid gap-5 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                  <f.icon className="size-4 text-blue-400" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-medium text-white">{f.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-sidebar-muted">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-[11px] text-sidebar-muted">Authorised use only. All activity on this system is logged and monitored.</p>
      </section>
      <section className="relative flex items-center justify-center px-4 py-12 sm:px-8">
        <ThemeToggle className="absolute right-4 top-4" />
        <div className="animate-fade-up w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <div>
              <p className="font-semibold">{APP_NAME}</p>
              <p className="text-xs text-muted-foreground">{APP_TAGLINE}</p>
            </div>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
