import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox, PlusCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import { DataTable, type Column, type Row } from '@/components/data-table';
import { ActiveFilters, UrlSelect } from '@/components/url-filters';
import { RiskMeter, SeverityBadge, SlaIndicator, StatusBadge } from '@/components/incidents/badges';
import { requireUser } from '@/server/auth/dal';
import { listIncidents } from '@/server/services/incidents';
import { listResponders } from '@/server/services/users';
import { can } from '@/lib/rbac';
import { CATEGORIES, CATEGORY_KEYS, SEVERITIES, SEVERITY_ORDER } from '@/lib/risk';
import { STATUSES, STATUS_KEYS, slaStatus } from '@/lib/workflow';
import { formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Incidents' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function IncidentsPage({ searchParams }: PageProps<'/incidents'>) {
  const user = await requireUser();
  const sp = await searchParams;
  const staff = can(user, 'incident.view_all');
  const filters = {
    q: str(sp.q)?.slice(0, 100),
    status: str(sp.status),
    severity: str(sp.severity),
    category: str(sp.category),
    assignee: staff ? str(sp.assignee) : undefined,
    sla: str(sp.sla),
    sort: str(sp.sort),
    dir: str(sp.dir),
    size: Number(str(sp.size)) || undefined,
    page: Number(str(sp.page)) || 1,
  };
  const list = await listIncidents(user, filters);
  const responders = staff ? await listResponders() : [];

  const statusOptions = [
    { value: 'open', label: 'Open (any stage)' },
    { value: 'closed', label: 'Closed or rejected' },
    ...STATUS_KEYS.map((s) => ({ value: s, label: STATUSES[s].label })),
  ];
  const severityOptions = [...SEVERITY_ORDER].reverse().map((s) => ({ value: s, label: SEVERITIES[s].label }));
  const categoryOptions = CATEGORY_KEYS.map((c) => ({ value: c, label: CATEGORIES[c].label }));
  const assigneeOptions = [{ value: 'me', label: 'Assigned to me' }, { value: 'unassigned', label: 'Unassigned' }, ...responders.map((r) => ({ value: String(r.id), label: r.fullName }))];

  const views = staff
    ? [
        { label: 'Open', href: '/incidents?status=open&sort=severity', active: filters.status === 'open' && !filters.assignee && !filters.sla },
        { label: 'Assigned to me', href: '/incidents?status=open&assignee=me', active: filters.assignee === 'me' },
        { label: 'Unassigned', href: '/incidents?status=open&assignee=unassigned', active: filters.assignee === 'unassigned' },
        { label: 'SLA overdue', href: '/incidents?sla=overdue&sort=due', active: filters.sla === 'overdue' },
        { label: 'All', href: '/incidents', active: !filters.status && !filters.assignee && !filters.sla && !filters.severity && !filters.category && !filters.q },
      ]
    : [];

  const columns: Column[] = [
    { key: 'title', header: 'Incident', sortable: true, hideable: false },
    { key: 'severity', header: 'Severity', sortable: true, descFirst: true },
    { key: 'risk', header: 'Risk', sortable: true, descFirst: true, minScreen: 'md' },
    { key: 'status', header: 'Status', sortable: true },
    ...(staff ? [{ key: 'assignee', header: 'Assignee', minScreen: 'lg' as const }] : []),
    { key: 'due', header: 'Resolution SLA', sortable: true, minScreen: 'md' },
    { key: 'reported', header: 'Reported', sortable: true, descFirst: true, minScreen: 'sm' },
  ];

  const rows: Row[] = list.rows.map((i) => {
    const sla = slaStatus(i);
    return {
      id: i.id,
      href: `/incidents/${i.id}`,
      tone: sla.resolve === 'overdue' ? 'critical' : i.status === 'rejected' ? 'muted' : undefined,
      cells: {
        title: (
          <div className="max-w-md">
            <Link href={`/incidents/${i.id}`} className="block truncate font-medium transition-colors group-hover:text-primary">
              {i.title}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{i.reference}</span> · {CATEGORIES[i.category].label}
              {staff && <> · by {i.reporterName}</>}
            </p>
          </div>
        ),
        severity: <SeverityBadge severity={i.severity} />,
        risk: <RiskMeter score={i.riskScore} severity={i.severity} />,
        status: <StatusBadge status={i.status} />,
        assignee: i.assigneeName ? <span className="text-sm">{i.assigneeName}</span> : <span className="text-xs text-serious-ink">Unassigned</span>,
        due: <SlaIndicator state={sla.resolve} />,
        reported: (
          <span className="whitespace-nowrap text-xs text-muted-foreground" title={formatDateTime(i.createdAt)}>
            {timeAgo(i.createdAt)}
          </span>
        ),
      },
    };
  });

  return (
    <>
      <PageHeader
        title={staff ? 'Incidents' : 'My reports'}
        description={staff ? 'Every reported incident. Sort, filter and search to find what needs action.' : 'Incidents you have reported and their current status.'}
        actions={
          can(user, 'incident.create') && (
            <Link href="/incidents/new" className={buttonClass({ size: 'sm' })}>
              <PlusCircle aria-hidden /> Report incident
            </Link>
          )
        }
      />

      {views.length > 0 && (
        <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Quick views">
          {views.map((v) => (
            <Link
              key={v.label}
              href={v.href}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-all duration-200',
                v.active ? 'bg-primary text-primary-foreground shadow-sm ring-primary' : 'bg-card text-muted-foreground ring-border hover:-translate-y-px hover:text-foreground',
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      )}

      <Card className="flex flex-col overflow-hidden">
        <DataTable
          id={staff ? 'incidents-staff' : 'incidents-reporter'}
          mode="server"
          caption="Incidents"
          columns={columns}
          rows={rows}
          total={list.total}
          page={list.page}
          pageSize={list.pageSize}
          sort={list.sort}
          dir={list.dir}
          query={filters.q ?? ''}
          searchPlaceholder="Search reference, title or description"
          empty={
            <EmptyState icon={<Inbox />} title="No incidents match these filters">
              {staff ? 'Try removing a filter.' : 'Reports you submit will appear here.'}
            </EmptyState>
          }
          toolbar={
            <div className="flex flex-wrap gap-2">
              <UrlSelect name="status" label="Any status" options={statusOptions} />
              <UrlSelect name="severity" label="Any severity" options={severityOptions} />
              <UrlSelect name="category" label="Any category" options={categoryOptions} />
              {staff && <UrlSelect name="assignee" label="Anyone" options={assigneeOptions} />}
            </div>
          }
        />
        <div className="order-first">
          <ActiveFilters
            labels={{
              status: Object.fromEntries(statusOptions.map((o) => [o.value, o.label])),
              severity: Object.fromEntries(severityOptions.map((o) => [o.value, `${o.label} severity`])),
              category: Object.fromEntries(categoryOptions.map((o) => [o.value, o.label])),
              assignee: Object.fromEntries(assigneeOptions.map((o) => [o.value, o.label])),
              sla: { overdue: 'SLA overdue' },
              q: 'text',
            }}
          />
        </div>
      </Card>
    </>
  );
}
