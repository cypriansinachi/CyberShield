import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Link2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge, PageHeader, StatTile } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import { DataTable, type Column, type Row } from '@/components/data-table';
import { ActiveFilters, UrlSelect } from '@/components/url-filters';
import { VerifyAuditButton } from '@/components/verify-audit-button';
import { requirePermission } from '@/server/auth/dal';
import { auditStats, queryAuditLogs } from '@/server/services/analytics';
import { formatDateTime, timeAgo } from '@/lib/format';

export const metadata: Metadata = { title: 'Audit log' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : undefined);

const ACTION_GROUPS = [
  { value: 'auth.', label: 'Authentication' },
  { value: 'access.denied', label: 'Access denied' },
  { value: 'incident.', label: 'Incidents' },
  { value: 'evidence.', label: 'Evidence' },
  { value: 'user.', label: 'User administration' },
  { value: 'report.', label: 'Reports & exports' },
  { value: 'audit.', label: 'Audit' },
];
const OUTCOMES = [
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
  { value: 'denied', label: 'Denied' },
];

export default async function AuditPage({ searchParams }: PageProps<'/audit'>) {
  await requirePermission('audit.view');
  const sp = await searchParams;
  const q = str(sp.q);
  const filters = {
    action: str(sp.action),
    actor: q,
    outcome: str(sp.outcome),
    entity: str(sp.entity),
    size: Number(str(sp.size)) || undefined,
    page: Number(str(sp.page)) || 1,
  };
  const log = await queryAuditLogs(filters);
  const stats = await auditStats();
  const exportQs = new URLSearchParams(
    Object.entries({ action: filters.action, actor: filters.actor, outcome: filters.outcome, entity: filters.entity }).filter(([, v]) => v) as [string, string][],
  ).toString();

  const columns: Column[] = [
    { key: 'id', header: '#', className: 'font-mono text-xs text-muted-foreground' },
    { key: 'ts', header: 'Time' },
    { key: 'actor', header: 'Actor', hideable: false },
    { key: 'action', header: 'Action', hideable: false },
    { key: 'entity', header: 'Entity', minScreen: 'md' },
    { key: 'outcome', header: 'Outcome' },
    { key: 'ip', header: 'IP address', minScreen: 'xl', defaultHidden: true },
    { key: 'details', header: 'Details' },
  ];

  const rows: Row[] = log.rows.map((r) => ({
    id: r.id,
    tone: r.outcome === 'denied' ? 'critical' : undefined,
    cells: {
      id: r.id,
      ts: (
        <span className="whitespace-nowrap text-xs" title={formatDateTime(r.ts)}>
          {formatDateTime(r.ts)}
          <span className="block text-muted-foreground">{timeAgo(r.ts)}</span>
        </span>
      ),
      actor: (
        <span className="block max-w-52 text-xs">
          <span className="block truncate">{r.actor_email ?? <span className="text-muted-foreground">system / anonymous</span>}</span>
          {r.actor_role && <span className="text-muted-foreground">{r.actor_role}</span>}
        </span>
      ),
      action: <code className="font-mono text-xs">{r.action}</code>,
      entity:
        r.entity_type === 'incident' || r.entity_type === 'user' ? (
          <Link href={r.entity_type === 'incident' ? `/incidents/${r.entity_id}` : `/admin/users/${r.entity_id}`} className="font-mono text-xs text-primary hover:underline">
            {r.entity_type}:{r.entity_id}
          </Link>
        ) : undefined,
      outcome: <Badge tone={r.outcome === 'success' ? 'good' : r.outcome === 'denied' ? 'critical' : 'serious'}>{r.outcome}</Badge>,
      ip: <span className="font-mono text-xs text-muted-foreground">{r.ip ?? '—'}</span>,
      details: (
        <details className="max-w-80 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">view</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-[11px]">
            {JSON.stringify(JSON.parse(r.details), null, 2)}
          </pre>
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
            prev {r.prev_hash.slice(0, 16)}… → hash {r.hash.slice(0, 16)}…
          </p>
        </details>
      ),
    },
  }));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only, tamper-evident record of every security-relevant action. Each entry is sealed with an HMAC-SHA256 hash chained to the previous entry."
        actions={
          <a href={`/api/export/audit?${exportQs}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            <Download aria-hidden /> Export CSV
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Total entries" value={stats.total.toLocaleString('en')} />
          <StatTile label="Last 24 hours" value={stats.last24} />
          <StatTile label="Failures (7 d)" value={stats.failed7} tone={stats.failed7 ? 'serious' : undefined} />
          <StatTile label="Denied (7 d)" value={stats.denied7} tone={stats.denied7 ? 'critical' : undefined} />
        </section>
        <Card>
          <CardHeader title="Chain integrity" icon={<Link2 />} />
          <CardBody className="space-y-2">
            <p className="break-all font-mono text-[10px] text-muted-foreground">head: {stats.head ?? '—'}</p>
            <VerifyAuditButton />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6 flex flex-col overflow-hidden">
        <div className="order-first">
          <ActiveFilters
            labels={{
              action: Object.fromEntries(ACTION_GROUPS.map((o) => [o.value, o.label])),
              outcome: Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label])),
              entity: 'text',
              q: 'text',
            }}
          />
        </div>
        <DataTable
          id="audit"
          mode="server"
          caption="Audit log entries"
          columns={columns}
          rows={rows}
          total={log.total}
          page={log.page}
          pageSize={log.pageSize}
          pageSizes={[10, 25, 50, 100]}
          query={q ?? ''}
          searchPlaceholder="Filter by actor email…"
          empty="No audit entries match these filters."
          toolbar={
            <div className="flex flex-wrap gap-2">
              <UrlSelect name="action" label="All actions" options={ACTION_GROUPS} />
              <UrlSelect name="outcome" label="Any outcome" options={OUTCOMES} />
            </div>
          }
        />
      </Card>
    </>
  );
}
