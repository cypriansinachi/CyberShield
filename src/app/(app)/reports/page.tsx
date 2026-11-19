import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, FileBarChart2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader, StatTile, Table } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import { DataTable } from '@/components/data-table';
import { SeverityBadge, StatusBadge } from '@/components/incidents/badges';
import { requirePermission } from '@/server/auth/dal';
import { getIncidentReport } from '@/server/services/analytics';
import { RANGE_PRESETS, resolveRange } from '@/server/services/range';
import { can } from '@/lib/rbac';
import { CATEGORIES, SEVERITY_ORDER, SEVERITIES } from '@/lib/risk';
import { formatDate, formatHours, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Reports' };

export default async function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  const user = await requirePermission('report.view');
  const sp = await searchParams;
  const range = resolveRange(sp);
  const r = await getIncidentReport(range.fromIso, range.toIso);
  const s = r.summary;
  const exportQs = range.key === 'custom' ? `from=${range.fromDay}&to=${range.toDay}` : `range=${range.key}`;
  const sevCols = [...SEVERITY_ORDER].reverse();

  return (
    <>
      <PageHeader
        title="Management reports"
        description={`Incident volume, severity and response performance for ${range.label.toLowerCase()} (${formatDate(range.fromIso)} – ${formatDate(new Date(Date.parse(range.toIso) - 1).toISOString())}).`}
        actions={
          can(user, 'report.export') && (
            <a href={`/api/export/incidents?${exportQs}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              <Download aria-hidden /> Export CSV
            </a>
          )
        }
      />

      <Card className="mb-6">
        <form method="get" className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <Link
                key={p.key}
                href={`/reports?range=${p.key}`}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset',
                  range.key === p.key ? 'bg-primary text-primary-foreground ring-primary' : 'bg-card text-muted-foreground ring-border hover:text-foreground',
                )}
              >
                {p.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">
              From
              <input type="date" name="from" defaultValue={range.fromDay} className="mt-1 block h-9 rounded-lg border border-input bg-card px-2 text-sm text-foreground" />
            </label>
            <label className="text-xs text-muted-foreground">
              To
              <input type="date" name="to" defaultValue={range.toDay} className="mt-1 block h-9 rounded-lg border border-input bg-card px-2 text-sm text-foreground" />
            </label>
            <button className={buttonClass({ variant: 'secondary' })}>Apply</button>
          </div>
        </form>
      </Card>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Incidents reported" value={s.total} sub={`${s.open} still open`} />
        <StatTile label="Critical + High" value={s.severityCounts.critical + s.severityCounts.high} sub={`${s.severityCounts.critical} critical`} />
        <StatTile label="Avg. time to acknowledge" value={formatHours(s.mttaHours)} />
        <StatTile label="Avg. time to resolve" value={formatHours(s.mttrHours)} sub={`${s.closed} closed · ${s.rejected} rejected`} />
        <StatTile label="Acknowledge SLA met" value={formatPercent(s.ackSla)} />
        <StatTile label="Resolution SLA met" value={formatPercent(s.resolveSla)} sub={`${s.breaches} notifiable breaches`} />
      </section>

      {s.total === 0 ? (
        <Card className="mt-6">
          <EmptyState icon={<FileBarChart2 />} title="No incidents in this period" />
        </Card>
      ) : (
        <>
          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Category × severity" description="Where incidents come from and how serious they are" />
              <Table>
                <thead>
                  <tr>
                    <th>Category</th>
                    {sevCols.map((sv) => (
                      <th key={sv} className="text-right">
                        {SEVERITIES[sv].label}
                      </th>
                    ))}
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {r.matrix.map((m) => (
                    <tr key={m.category}>
                      <td>{m.label}</td>
                      {sevCols.map((sv) => (
                        <td key={sv} className={cn('text-right', m[sv] === 0 && 'text-muted-foreground/50')}>
                          {m[sv]}
                        </td>
                      ))}
                      <td className="text-right font-medium">{m.total}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40 font-medium">
                    <td>Total</td>
                    {sevCols.map((sv) => (
                      <td key={sv} className="text-right">
                        {s.severityCounts[sv]}
                      </td>
                    ))}
                    <td className="text-right">{s.total}</td>
                  </tr>
                </tbody>
              </Table>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader title="By department" />
                <Table>
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Major</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {r.departments.map((d) => (
                      <tr key={d.name}>
                        <td>{d.name}</td>
                        <td className="text-right">{d.total}</td>
                        <td className="text-right">{d.major}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
              <Card>
                <CardHeader title="By status" />
                <CardBody className="flex flex-wrap gap-2">
                  {r.statuses.map((st) => (
                    <span key={st.status} className="inline-flex items-center gap-2 text-sm">
                      <StatusBadge status={st.status} /> <span className="tabular-nums">{st.count}</span>
                    </span>
                  ))}
                </CardBody>
              </Card>
            </div>
          </div>

          <Card className="mt-6 overflow-hidden">
            <CardHeader title="Incident register" description={`${r.rows.length} incidents in this period · sort, search and page through them below`} />
            <DataTable
              id="report-register"
              caption="Incident register"
              defaultSort={{ key: 'reported', dir: 'desc' }}
              searchPlaceholder="Search the register…"
              columns={[
                { key: 'reference', header: 'Reference', sortable: true },
                { key: 'title', header: 'Title', sortable: true, hideable: false },
                { key: 'category', header: 'Category', sortable: true, minScreen: 'lg' },
                { key: 'severity', header: 'Severity', sortable: true, descFirst: true },
                { key: 'status', header: 'Status', sortable: true },
                { key: 'department', header: 'Department', sortable: true, defaultHidden: true },
                { key: 'reported', header: 'Reported', sortable: true, descFirst: true, minScreen: 'sm' },
                { key: 'assignee', header: 'Assignee', sortable: true, minScreen: 'md' },
              ]}
              rows={r.rows.map((row) => ({
                id: row.id,
                href: `/incidents/${row.id}`,
                values: {
                  reference: row.reference,
                  title: row.title,
                  category: CATEGORIES[row.category]?.label,
                  severity: SEVERITIES[row.severity].rank,
                  status: row.status,
                  department: row.department,
                  reported: row.created_at,
                  assignee: row.assignee,
                },
                cells: {
                  reference: (
                    <Link href={`/incidents/${row.id}`} className="font-mono text-xs transition-colors hover:text-primary">
                      {row.reference}
                    </Link>
                  ),
                  title: <span className="block max-w-64 truncate">{row.title}</span>,
                  category: <span className="text-xs">{CATEGORIES[row.category]?.label}</span>,
                  severity: <SeverityBadge severity={row.severity} />,
                  status: <StatusBadge status={row.status} />,
                  department: <span className="text-xs">{row.department ?? '—'}</span>,
                  reported: <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(row.created_at)}</span>,
                  assignee: <span className="text-xs">{row.assignee ?? '—'}</span>,
                },
              }))}
            />
          </Card>
        </>
      )}
    </>
  );
}
