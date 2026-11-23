import 'server-only';
/**
 * Read-only analytics for the security dashboard, management reports and the
 * compliance overview. Aggregations are written in plain SQL for clarity.
 */
import { sqlAll, sqlOne } from '../db';
import { verifyAuditChain } from '../audit';
import { config } from '../config';
import { CATEGORIES, SEVERITY_ORDER, type Category, type Severity } from '@/lib/risk';
import { OPEN_STATUSES, STATUSES, type Status } from '@/lib/workflow';
import { PRIVILEGED_ROLES } from '@/lib/rbac';
import { formatDay, zonedDay } from '@/lib/format';

const OPEN_SQL = `(${OPEN_STATUSES.map((s) => `'${s}'`).join(',')})`;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const pct = (num: number, den: number) => (den ? (num / den) * 100 : null);

type Row = Record<string, unknown>;
type Arg = string | number | null;
const all = <T = Row>(sql: string, ...params: Arg[]) => sqlAll<T>(sql, params);
const one = <T = Row>(sql: string, ...params: Arg[]) => sqlOne<T>(sql, params);

// ───────────────────────────── Security dashboard ─────────────────────────────

export async function getSecurityDashboard(now = Date.now()) {
  const nowIso = iso(now);
  const d30 = iso(now - 30 * DAY);
  const d60 = iso(now - 60 * DAY);
  const d90 = iso(now - 90 * DAY);

  const openBySeverity = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  for (const r of await all<{ severity: Severity; n: number }>(`SELECT severity, COUNT(*) n FROM incidents WHERE status IN ${OPEN_SQL} GROUP BY severity`)) {
    openBySeverity[r.severity] = r.n;
  }
  const openTotal = Object.values(openBySeverity).reduce((a, b) => a + b, 0);

  const overdue = (await one<{ n: number }>(`SELECT COUNT(*) n FROM incidents WHERE status IN ${OPEN_SQL} AND sla_resolve_due_at < ?`, nowIso)).n;
  const unassigned = (await one<{ n: number }>(`SELECT COUNT(*) n FROM incidents WHERE status IN ${OPEN_SQL} AND assignee_id IS NULL`)).n;
  const reported30 = (await one<{ n: number }>('SELECT COUNT(*) n FROM incidents WHERE created_at >= ?', d30)).n;
  const reportedPrev30 = (await one<{ n: number }>('SELECT COUNT(*) n FROM incidents WHERE created_at >= ? AND created_at < ?', d60, d30)).n;

  const mtta = (await one<{ h: number | null }>(
    `SELECT AVG((julianday(acknowledged_at) - julianday(created_at)) * 24) h
       FROM incidents WHERE acknowledged_at IS NOT NULL AND created_at >= ?`,
    d30,
  )).h;
  const mttr = (await one<{ h: number | null }>(
    `SELECT AVG((julianday(closed_at) - julianday(created_at)) * 24) h
       FROM incidents WHERE status = 'closed' AND closed_at >= ?`,
    d30,
  )).h;
  const sla = await one<{ met: number; total: number }>(
    `SELECT COALESCE(SUM(closed_at <= sla_resolve_due_at), 0) met, COUNT(*) total
       FROM incidents WHERE status = 'closed' AND closed_at >= ?`,
    d30,
  );

  // 30-day trend, bucketed by calendar day in the organisation's timezone.
  const days: { day: string; label: string; reported: number; resolved: number }[] = [];
  const index = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    index.set(zonedDay(d), days.length);
    days.push({ day: zonedDay(d), label: formatDay(d), reported: 0, resolved: 0 });
  }
  const windowStart = iso(now - 31 * DAY);
  for (const r of await all<{ created_at: string }>('SELECT created_at FROM incidents WHERE created_at >= ?', windowStart)) {
    const k = index.get(zonedDay(r.created_at));
    if (k !== undefined) days[k].reported++;
  }
  for (const r of await all<{ closed_at: string }>("SELECT closed_at FROM incidents WHERE status = 'closed' AND closed_at >= ?", windowStart)) {
    const k = index.get(zonedDay(r.closed_at));
    if (k !== undefined) days[k].resolved++;
  }

  const byCategory = (await all<{ category: Category; n: number }>(
    'SELECT category, COUNT(*) n FROM incidents WHERE created_at >= ? GROUP BY category ORDER BY n DESC',
    d90,
  )).map((r) => ({ key: r.category, label: CATEGORIES[r.category]?.label ?? r.category, count: r.n }));

  const pipeline = OPEN_STATUSES.map((s) => ({ key: s, label: STATUSES[s].label, count: 0 }));
  for (const r of await all<{ status: Status; n: number }>(`SELECT status, COUNT(*) n FROM incidents WHERE status IN ${OPEN_SQL} GROUP BY status`)) {
    const p = pipeline.find((x) => x.key === r.status);
    if (p) p.count = r.n;
  }

  const workload = await all<{ id: number; name: string; role: string; open: number; major: number; overdue: number }>(
    `SELECT u.id, u.full_name name, u.role,
            COUNT(i.id) open,
            COALESCE(SUM(i.severity IN ('high', 'critical')), 0) major,
            COALESCE(SUM(i.sla_resolve_due_at < ?), 0) overdue
       FROM users u
       LEFT JOIN incidents i ON i.assignee_id = u.id AND i.status IN ${OPEN_SQL}
      WHERE u.is_active = 1 AND u.role IN ('analyst', 'manager')
      GROUP BY u.id ORDER BY open DESC, name ASC`,
    nowIso,
  );

  const priorityQueue = await all<{
    id: number; reference: string; title: string; severity: Severity; status: Status;
    sla_resolve_due_at: string; assignee: string | null; created_at: string;
  }>(
    `SELECT i.id, i.reference, i.title, i.severity, i.status, i.sla_resolve_due_at, i.created_at, a.full_name assignee
       FROM incidents i LEFT JOIN users a ON a.id = i.assignee_id
      WHERE i.status IN ${OPEN_SQL} AND i.severity IN ('critical', 'high')
      ORDER BY CASE i.severity WHEN 'critical' THEN 0 ELSE 1 END, i.sla_resolve_due_at ASC
      LIMIT 6`,
  );

  const pendingNotifications = await all<{ id: number; reference: string; title: string; notification_due_at: string }>(
    `SELECT id, reference, title, notification_due_at FROM incidents
      WHERE breach_notifiable = 1 AND notified_at IS NULL AND status != 'rejected'
      ORDER BY notification_due_at ASC LIMIT 5`,
  );

  return {
    kpis: {
      openTotal,
      majorOpen: openBySeverity.critical + openBySeverity.high,
      criticalOpen: openBySeverity.critical,
      overdue,
      unassigned,
      reported30,
      reportedPrev30,
      mttaHours: mtta,
      mttrHours: mttr,
      slaCompliance: pct(sla.met, sla.total),
      slaClosed: sla.total,
    },
    openBySeverity,
    trend: days,
    byCategory,
    pipeline,
    workload,
    priorityQueue,
    pendingNotifications,
  };
}

// ───────────────────────────── Management report ─────────────────────────────

export type ReportRow = {
  id: number; reference: string; title: string; category: Category; severity: Severity; status: Status;
  affected_service: string | null; created_at: string; acknowledged_at: string | null; closed_at: string | null;
  sla_ack_due_at: string; sla_resolve_due_at: string; risk_score: number; reporter: string; assignee: string | null;
  breach_notifiable: number; notified_at: string | null; notification_due_at: string | null; root_cause: string | null;
};

export async function getIncidentReport(fromIso: string, toIso: string) {
  const rows = await all<ReportRow>(
    `SELECT i.id, i.reference, i.title, i.category, i.severity, i.status, i.affected_service, i.created_at,
            i.acknowledged_at, i.closed_at, i.sla_ack_due_at, i.sla_resolve_due_at, i.risk_score,
            i.breach_notifiable, i.notified_at, i.notification_due_at, i.root_cause,
            r.full_name reporter, a.full_name assignee
       FROM incidents i
       JOIN users r ON r.id = i.reporter_id
       LEFT JOIN users a ON a.id = i.assignee_id
      WHERE i.created_at >= ? AND i.created_at < ?
      ORDER BY i.created_at DESC`,
    fromIso,
    toIso,
  );

  const severityCounts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  const matrix = new Map<Category, Record<Severity, number> & { total: number }>();
  const services = new Map<string, { total: number; major: number }>();
  const statusCounts = new Map<Status, number>();
  let ackMet = 0, ackTotal = 0, resMet = 0, resTotal = 0, ackHours = 0, resHours = 0, breaches = 0, breachesOnTime = 0;

  for (const r of rows) {
    severityCounts[r.severity]++;
    const m = matrix.get(r.category) ?? { low: 0, medium: 0, high: 0, critical: 0, total: 0 };
    m[r.severity]++;
    m.total++;
    matrix.set(r.category, m);
    const service = r.affected_service ?? 'Unspecified';
    const svc = services.get(service) ?? { total: 0, major: 0 };
    svc.total++;
    if (r.severity === 'high' || r.severity === 'critical') svc.major++;
    services.set(service, svc);
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);

    if (r.acknowledged_at) {
      ackTotal++;
      ackHours += (Date.parse(r.acknowledged_at) - Date.parse(r.created_at)) / 3_600_000;
      if (r.acknowledged_at <= r.sla_ack_due_at) ackMet++;
    }
    if (r.status === 'closed' && r.closed_at) {
      resTotal++;
      resHours += (Date.parse(r.closed_at) - Date.parse(r.created_at)) / 3_600_000;
      if (r.closed_at <= r.sla_resolve_due_at) resMet++;
    }
    if (r.breach_notifiable) {
      breaches++;
      if (r.notified_at && r.notification_due_at && r.notified_at <= r.notification_due_at) breachesOnTime++;
    }
  }

  return {
    rows,
    summary: {
      total: rows.length,
      open: rows.filter((r) => STATUSES[r.status].open).length,
      closed: statusCounts.get('closed') ?? 0,
      rejected: statusCounts.get('rejected') ?? 0,
      severityCounts,
      mttaHours: ackTotal ? ackHours / ackTotal : null,
      mttrHours: resTotal ? resHours / resTotal : null,
      ackSla: pct(ackMet, ackTotal),
      resolveSla: pct(resMet, resTotal),
      breaches,
      breachesOnTime,
    },
    matrix: [...matrix.entries()]
      .map(([category, counts]) => ({ category, label: CATEGORIES[category]?.label ?? category, ...counts }))
      .sort((a, b) => b.total - a.total),
    services: [...services.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
    statuses: [...statusCounts.entries()].map(([status, count]) => ({ status, label: STATUSES[status].label, count })),
  };
}

// ───────────────────────────── Compliance overview ─────────────────────────────

export async function getComplianceOverview(now = Date.now()) {
  const nowIso = iso(now);
  const d90 = iso(now - 90 * DAY);

  const breach = await one<{ total: number; on_time: number; late: number; pending: number; overdue: number }>(
    `SELECT COUNT(*) total,
            COALESCE(SUM(notified_at IS NOT NULL AND notified_at <= notification_due_at), 0) on_time,
            COALESCE(SUM(notified_at IS NOT NULL AND notified_at > notification_due_at), 0) late,
            COALESCE(SUM(notified_at IS NULL AND notification_due_at >= ?), 0) pending,
            COALESCE(SUM(notified_at IS NULL AND notification_due_at < ?), 0) overdue
       FROM incidents WHERE breach_notifiable = 1 AND status != 'rejected'`,
    nowIso,
    nowIso,
  );

  const pendingBreaches = await all<{ id: number; reference: string; title: string; notification_due_at: string; status: Status }>(
    `SELECT id, reference, title, notification_due_at, status FROM incidents
      WHERE breach_notifiable = 1 AND notified_at IS NULL AND status != 'rejected'
      ORDER BY notification_due_at ASC`,
  );

  const lessons = await one<{ total: number; documented: number }>(
    `SELECT COUNT(*) total, COALESCE(SUM(lessons_learned IS NOT NULL AND length(lessons_learned) >= 10), 0) documented
       FROM incidents WHERE status = 'closed' AND severity IN ('high', 'critical')`,
  );
  const rootCause = await one<{ total: number; documented: number }>(
    `SELECT COUNT(*) total, COALESCE(SUM(root_cause IS NOT NULL AND length(root_cause) >= 10), 0) documented
       FROM incidents WHERE status = 'closed'`,
  );
  const sla = await one<{ ack_met: number; ack_total: number; res_met: number; res_total: number }>(
    `SELECT COALESCE(SUM(acknowledged_at IS NOT NULL AND acknowledged_at <= sla_ack_due_at), 0) ack_met,
            COALESCE(SUM(acknowledged_at IS NOT NULL), 0) ack_total,
            COALESCE(SUM(status = 'closed' AND closed_at <= sla_resolve_due_at), 0) res_met,
            COALESCE(SUM(status = 'closed'), 0) res_total
       FROM incidents WHERE created_at >= ?`,
    d90,
  );

  const privileged = `(${PRIVILEGED_ROLES.map((r) => `'${r}'`).join(',')})`;
  const mfa = await one<{ total: number; enrolled: number }>(
    `SELECT COUNT(*) total, COALESCE(SUM(mfa_enabled), 0) enrolled FROM users WHERE is_active = 1 AND role IN ${privileged}`,
  );
  const accounts = await one<{ locked: number; inactive: number; dormant: number; must_change: number }>(
    `SELECT COALESCE(SUM(locked_until IS NOT NULL AND locked_until > ?), 0) locked,
            COALESCE(SUM(is_active = 0), 0) inactive,
            COALESCE(SUM(is_active = 1 AND (last_login_at IS NULL OR last_login_at < ?)), 0) dormant,
            COALESCE(SUM(must_change_password = 1), 0) must_change
       FROM users`,
    nowIso,
    d90,
  );
  const auth = await one<{ failed24: number; failed7: number; denied7: number }>(
    `SELECT COALESCE(SUM(action = 'auth.login_failed' AND ts >= ?), 0) failed24,
            COALESCE(SUM(action = 'auth.login_failed'), 0) failed7,
            COALESCE(SUM(outcome = 'denied'), 0) denied7
       FROM audit_logs WHERE ts >= ?`,
    iso(now - DAY),
    iso(now - 7 * DAY),
  );

  return {
    breach: { ...breach, onTimeRate: pct(breach.on_time, breach.on_time + breach.late) },
    pendingBreaches,
    lessons: { ...lessons, rate: pct(lessons.documented, lessons.total) },
    rootCause: { ...rootCause, rate: pct(rootCause.documented, rootCause.total) },
    sla: { ackRate: pct(sla.ack_met, sla.ack_total), resolveRate: pct(sla.res_met, sla.res_total), ackTotal: sla.ack_total, resolveTotal: sla.res_total },
    mfa: { ...mfa, rate: pct(mfa.enrolled, mfa.total), enforced: config.security.requireMfaForPrivileged },
    accounts,
    auth,
    auditChain: await verifyAuditChain(),
    regulator: config.compliance.regulatorName,
    notificationHours: config.compliance.breachNotificationHours,
  };
}

// ───────────────────────────── Audit log browser ─────────────────────────────

export type AuditFilters = { action?: string; actor?: string; outcome?: string; entity?: string; from?: string; to?: string; page?: number; size?: number };
export const AUDIT_PAGE_SIZE = 25;

function auditWhere(f: AuditFilters) {
  const where: string[] = [];
  const params: Arg[] = [];
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  if (f.action) {
    where.push("action LIKE ? ESCAPE '\\'");
    params.push(`${esc(f.action)}%`);
  }
  if (f.actor) {
    where.push("actor_email LIKE ? ESCAPE '\\'");
    params.push(`%${esc(f.actor)}%`);
  }
  if (f.outcome && ['success', 'failure', 'denied'].includes(f.outcome)) {
    where.push('outcome = ?');
    params.push(f.outcome);
  }
  if (f.entity && /^(incident|user):\d+$/.test(f.entity)) {
    const [type, id] = f.entity.split(':');
    where.push('entity_type = ? AND entity_id = ?');
    params.push(type, id);
  }
  if (f.from) {
    where.push('ts >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('ts < ?');
    params.push(f.to);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export type AuditRow = {
  id: number; ts: string; actor_id: number | null; actor_email: string | null; actor_role: string | null; action: string;
  entity_type: string | null; entity_id: string | null; outcome: 'success' | 'failure' | 'denied'; ip: string | null;
  user_agent: string | null; request_id: string | null; details: string; prev_hash: string; hash: string;
};

export async function queryAuditLogs(f: AuditFilters) {
  const w = auditWhere(f);
  const total = (await one<{ n: number }>(`SELECT COUNT(*) n FROM audit_logs ${w.sql}`, ...w.params)).n;
  const pageSize = [10, 25, 50, 100].includes(f.size ?? 0) ? f.size! : AUDIT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, f.page ?? 1), pageCount);
  const rows = await all<AuditRow>(`SELECT * FROM audit_logs ${w.sql} ORDER BY id DESC LIMIT ? OFFSET ?`, ...w.params, pageSize, (page - 1) * pageSize);
  return { rows, total, page, pageCount, pageSize };
}

export async function exportAuditLogs(f: AuditFilters, limit = 50_000) {
  const w = auditWhere(f);
  return await all<AuditRow>(`SELECT * FROM audit_logs ${w.sql} ORDER BY id ASC LIMIT ?`, ...w.params, limit);
}

export async function auditStats(now = Date.now()) {
  return await one<{ total: number; last24: number; denied7: number; failed7: number; head: string | null }>(
    `SELECT COUNT(*) total,
            COALESCE(SUM(ts >= ?), 0) last24,
            COALESCE(SUM(outcome = 'denied' AND ts >= ?), 0) denied7,
            COALESCE(SUM(outcome = 'failure' AND ts >= ?), 0) failed7,
            (SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1) head
       FROM audit_logs`,
    iso(now - DAY),
    iso(now - 7 * DAY),
    iso(now - 7 * DAY),
  );
}
