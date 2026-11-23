import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertOctagon,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  FileWarning,
  Hourglass,
  Inbox,
  ListChecks,
  PlusCircle,
  ShieldAlert,
  Timer,
  UserX,
} from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, StatTile, Table } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import { SeverityBadge, SlaIndicator, StatusBadge } from '@/components/incidents/badges';
import { TrendChart } from '@/components/charts/trend-chart';
import { RankedBars, SeveritySplit } from '@/components/charts/bars';
import { requireUser } from '@/server/auth/dal';
import { getSecurityDashboard } from '@/server/services/analytics';
import { reporterSummary, runSlaEscalations } from '@/server/services/incidents';
import { can, ROLES } from '@/lib/rbac';
import { CATEGORIES } from '@/lib/risk';
import { slaStatus } from '@/lib/workflow';
import { formatDateTime, formatHours, formatPercent, isPast, timeAgo } from '@/lib/format';
import { ORG_NAME } from '@/lib/constants';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  const user = await requireUser();
  const sp = await searchParams;
  if (!can(user, 'dashboard.view')) return <ReporterHome userId={user.id} name={user.fullName} welcome={!!sp.welcome} />;

  await runSlaEscalations();
  const d = await getSecurityDashboard();
  const k = d.kpis;
  const delta = k.reported30 - k.reportedPrev30;

  return (
    <>
      <PageHeader
        eyebrow={ROLES[user.role].label}
        title="Security dashboard"
        description={`Live view of incident volume, risk and response performance across ${ORG_NAME}.`}
        actions={
          <>
            <Link href="/incidents?status=open&sort=severity" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              <ListChecks aria-hidden /> Open queue
            </Link>
            {can(user, 'incident.create') && (
              <Link href="/incidents/new" className={buttonClass({ size: 'sm' })}>
                <PlusCircle aria-hidden /> Report incident
              </Link>
            )}
          </>
        }
      />

      <section aria-label="Key indicators" className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Open incidents" value={k.openTotal} icon={<Inbox />} sub={`${k.reported30} reported in 30 days (${delta >= 0 ? '+' : ''}${delta} vs prior)`} />
        <StatTile label="Critical & high open" value={k.majorOpen} tone={k.criticalOpen ? 'critical' : undefined} icon={<ShieldAlert />} sub={`${k.criticalOpen} critical`} />
        <StatTile label="SLA overdue" value={k.overdue} tone={k.overdue ? 'critical' : 'good'} icon={<AlertOctagon />} sub="Past resolution deadline" />
        <StatTile label="Unassigned" value={k.unassigned} tone={k.unassigned ? 'serious' : undefined} icon={<UserX />} sub="Open with no responder" />
        <StatTile label="Avg. time to acknowledge" value={formatHours(k.mttaHours)} icon={<Timer />} sub="MTTA · last 30 days" />
        <StatTile label="Avg. time to resolve" value={formatHours(k.mttrHours)} icon={<Hourglass />} sub={`MTTR · SLA met ${formatPercent(k.slaCompliance)} of ${k.slaClosed}`} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Incident trend" description="Reported vs. resolved per day, last 30 days" />
          <CardBody>
            <TrendChart data={d.trend} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Open incidents by severity" description={`${k.openTotal} open in total`} />
          <CardBody>
            <SeveritySplit counts={d.openBySeverity} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Priority queue"
            description="Open Critical and High incidents, most urgent first"
            action={
              <Link href="/incidents?status=open&sort=severity" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                View all <ArrowRight className="size-3" />
              </Link>
            }
          />
          {d.priorityQueue.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Resolution SLA</th>
                </tr>
              </thead>
              <tbody>
                {d.priorityQueue.map((i) => {
                  const sla = slaStatus({
                    status: i.status,
                    createdAt: i.created_at,
                    acknowledgedAt: null,
                    closedAt: null,
                    slaAckDueAt: i.created_at,
                    slaResolveDueAt: i.sla_resolve_due_at,
                  });
                  return (
                    <tr key={i.id} className="hover:bg-muted/40">
                      <td className="max-w-72">
                        <Link href={`/incidents/${i.id}`} className="block truncate font-medium hover:text-primary">
                          {i.title}
                        </Link>
                        <span className="font-mono text-xs text-muted-foreground">{i.reference}</span>
                      </td>
                      <td>
                        <SeverityBadge severity={i.severity} />
                      </td>
                      <td>
                        <StatusBadge status={i.status} />
                      </td>
                      <td className="text-sm">{i.assignee ?? <span className="text-serious-ink">Unassigned</span>}</td>
                      <td>
                        <SlaIndicator state={sla.resolve} />
                        <span className="block text-xs text-muted-foreground">
                          {sla.resolve === 'overdue' ? 'due ' : ''}
                          {timeAgo(i.sla_resolve_due_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={<CheckCircle2 />} title="No open Critical or High incidents">
              The queue is clear.
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="Response pipeline" description="Open incidents by workflow stage" />
          <CardBody>
            <RankedBars items={d.pipeline.map((p) => ({ key: p.key, label: p.label, count: p.count }))} href={(s) => `/incidents?status=${s}`} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Incidents by category" description="Reported in the last 90 days" />
          <CardBody>
            <RankedBars items={d.byCategory} href={(c) => `/incidents?category=${c}`} empty="No incidents in the last 90 days." />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Team workload" description="Open incidents per responder" />
          <Table>
            <thead>
              <tr>
                <th>Responder</th>
                <th className="text-right">Open</th>
                <th className="text-right">Major</th>
                <th className="text-right">Overdue</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {d.workload.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Link href={`/incidents?assignee=${w.id}&status=open`} className="font-medium hover:text-primary">
                      {w.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{ROLES[w.role as keyof typeof ROLES]?.label}</span>
                  </td>
                  <td className="text-right">{w.open}</td>
                  <td className="text-right">{w.major}</td>
                  <td className={`text-right ${w.overdue ? 'font-medium text-critical-ink' : ''}`}>{w.overdue}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Breach notifications due" description="Personal-data breaches awaiting regulator notification" icon={<BellRing />} />
          {d.pendingNotifications.length ? (
            <ul className="divide-y divide-border">
              {d.pendingNotifications.map((n) => {
                const overdue = isPast(n.notification_due_at);
                return (
                  <li key={n.id} className="px-5 py-3">
                    <Link href={`/incidents/${n.id}`} className="block truncate text-sm font-medium hover:text-primary">
                      {n.title}
                    </Link>
                    <p className={`mt-0.5 flex items-center gap-1 text-xs ${overdue ? 'font-medium text-critical-ink' : 'text-muted-foreground'}`}>
                      <Clock className="size-3" aria-hidden />
                      {overdue ? 'Overdue since' : 'Due'} {formatDateTime(n.notification_due_at)} ({timeAgo(n.notification_due_at)})
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<CheckCircle2 />} title="Nothing pending">
              No unreported personal-data breaches.
            </EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}

async function ReporterHome({ userId, name, welcome }: { userId: number; name: string; welcome: boolean }) {
  const s = await reporterSummary(userId);
  return (
    <>
      <PageHeader title={`Welcome, ${name.split(' ')[0]}`} description={`Thank you for helping keep ${ORG_NAME} and its customers safe.`} />
      {welcome && (
        <Alert tone="success" title="Your account is ready" className="mb-6">
          You can now report security incidents and follow their progress here.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-7 text-white">
            <FileWarning className="size-7 opacity-90" aria-hidden />
            <h2 className="mt-3 text-xl font-semibold">Seen something suspicious?</h2>
            <p className="mt-1 max-w-lg text-sm text-blue-100">
              Tell our security team now, even if you are not sure. Early reports stop small problems from becoming serious breaches. It takes about two minutes.
            </p>
            <Link href="/incidents/new" className={buttonClass({ variant: 'secondary', className: 'mt-5 border-white/20 bg-white text-blue-700 hover:bg-blue-50' })}>
              <PlusCircle aria-hidden /> Report an incident
            </Link>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border">
            {[
              ['Reports submitted', s.total],
              ['Being handled', s.open],
              ['Resolved', s.resolved],
            ].map(([label, value]) => (
              <div key={label} className="px-6 py-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="What should I report?" />
          <CardBody className="space-y-2 text-sm text-muted-foreground">
            <p>• Emails, texts or calls claiming to be {ORG_NAME} that look wrong</p>
            <p>• A fake {ORG_NAME} website or app asking for your details</p>
            <p>• Sign-ins, payments or changes on your account that you didn&apos;t make</p>
            <p>• Someone else&apos;s information showing in your account</p>
            <p>• A security weakness or bug in our website or app</p>
            <p className="pt-2 text-xs">
              <strong className="text-foreground">We will never</strong> ask for your password or one-time codes. Don&apos;t reply to suspicious messages or try to investigate yourself.
            </p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="My recent reports"
          action={
            <Link href="/incidents" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          }
        />
        {s.recent.length ? (
          <ul className="divide-y divide-border">
            {s.recent.map((i) => (
              <li key={i.id}>
                <Link href={`/incidents/${i.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.title}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{i.reference}</span> · {CATEGORIES[i.category].label} · {timeAgo(i.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={i.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Inbox />} title="You haven't reported anything yet">
            When you report an incident you can follow its progress here.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
