import type { NextRequest } from 'next/server';
import { auditContextFor, getCurrentUser } from '@/server/auth/dal';
import { recordAudit } from '@/server/audit';
import { getIncidentReport } from '@/server/services/analytics';
import { resolveRange } from '@/server/services/range';
import { can } from '@/lib/rbac';
import { toCsv } from '@/lib/csv';
import { CATEGORIES, SEVERITIES } from '@/lib/risk';
import { STATUSES } from '@/lib/workflow';

/** CSV export of incidents for a date range (managers, admins, auditors). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const ctx = await auditContextFor(user);
  if (!can(user, 'report.export')) {
    await recordAudit(ctx, { action: 'access.denied', outcome: 'denied', details: { permission: 'report.export' } });
    return new Response('Forbidden', { status: 403 });
  }

  const range = resolveRange(Object.fromEntries(req.nextUrl.searchParams));
  const { rows } = await getIncidentReport(range.fromIso, range.toIso);
  const csv = toCsv(
    [
      { header: 'Reference', value: (r) => r.reference },
      { header: 'Title', value: (r) => r.title },
      { header: 'Category', value: (r) => CATEGORIES[r.category]?.label ?? r.category },
      { header: 'Severity', value: (r) => SEVERITIES[r.severity].label },
      { header: 'Risk score', value: (r) => r.risk_score },
      { header: 'Status', value: (r) => STATUSES[r.status].label },
      { header: 'Affected service', value: (r) => r.affected_service },
      { header: 'Reporter', value: (r) => r.reporter },
      { header: 'Assignee', value: (r) => r.assignee },
      { header: 'Reported (UTC)', value: (r) => r.created_at },
      { header: 'Acknowledged (UTC)', value: (r) => r.acknowledged_at },
      { header: 'Closed (UTC)', value: (r) => r.closed_at },
      { header: 'Ack SLA met', value: (r) => (r.acknowledged_at ? (r.acknowledged_at <= r.sla_ack_due_at ? 'yes' : 'no') : '') },
      { header: 'Resolve SLA met', value: (r) => (r.closed_at && r.status === 'closed' ? (r.closed_at <= r.sla_resolve_due_at ? 'yes' : 'no') : '') },
      { header: 'Notifiable breach', value: (r) => (r.breach_notifiable ? 'yes' : 'no') },
      { header: 'Regulator notified (UTC)', value: (r) => r.notified_at },
      { header: 'Root cause', value: (r) => r.root_cause },
    ],
    rows,
  );
  await recordAudit(ctx, { action: 'report.exported', details: { format: 'csv', rows: rows.length, from: range.fromIso, to: range.toIso } });
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="incidents_${range.fromDay}_${range.toDay}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
