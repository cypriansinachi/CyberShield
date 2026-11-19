import type { NextRequest } from 'next/server';
import { auditContextFor, getCurrentUser } from '@/server/auth/dal';
import { recordAudit } from '@/server/audit';
import { exportAuditLogs } from '@/server/services/analytics';
import { can } from '@/lib/rbac';
import { toCsv } from '@/lib/csv';

/** CSV export of the audit trail, including hashes so the chain can be verified offline. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const ctx = await auditContextFor(user);
  if (!can(user, 'audit.view')) {
    await recordAudit(ctx, { action: 'access.denied', outcome: 'denied', details: { permission: 'audit.view', export: true } });
    return new Response('Forbidden', { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const filters = {
    action: sp.get('action') ?? undefined,
    actor: sp.get('actor') ?? undefined,
    outcome: sp.get('outcome') ?? undefined,
    entity: sp.get('entity') ?? undefined,
  };
  const rows = await exportAuditLogs(filters);
  const csv = toCsv(
    [
      { header: 'id', value: (r) => r.id },
      { header: 'timestamp_utc', value: (r) => r.ts },
      { header: 'actor_email', value: (r) => r.actor_email },
      { header: 'actor_role', value: (r) => r.actor_role },
      { header: 'action', value: (r) => r.action },
      { header: 'entity', value: (r) => (r.entity_type ? `${r.entity_type}:${r.entity_id}` : '') },
      { header: 'outcome', value: (r) => r.outcome },
      { header: 'ip', value: (r) => r.ip },
      { header: 'request_id', value: (r) => r.request_id },
      { header: 'details', value: (r) => r.details },
      { header: 'prev_hash', value: (r) => r.prev_hash },
      { header: 'hash', value: (r) => r.hash },
    ],
    rows,
  );
  await recordAudit(ctx, { action: 'audit.exported', details: { rows: rows.length, filters } });
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit_log_${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
