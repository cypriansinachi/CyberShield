import 'server-only';
/**
 * Incident service: the core business logic for reporting, classifying and
 * responding to incidents. Every function:
 *   1. re-checks permissions (role + object-level access),
 *   2. validates the state change,
 *   3. writes the change and a timeline event in one transaction,
 *   4. records an audit entry and notifies the people involved.
 */
import { alias } from 'drizzle-orm/sqlite-core';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, type DB } from '../db';
import {
  attachments,
  auditLogs,
  incidentEvents,
  incidents,
  incidentTasks,
  users,
  evidenceBlobs,
  type EventType,
  type Incident,
  type TaskStatus,
} from '../db/schema';
import { config } from '../config';
import { recordAudit, type AuditContext } from '../audit';
import { notifyRoles, notifyUsers } from './notifications';
import { readEvidence, sealEvidence, type PreparedEvidence } from './evidence';
import { classify, SEVERITIES, type RiskInput, type Severity, CATEGORY_KEYS, CATEGORIES } from '@/lib/risk';
import {
  OPEN_STATUSES,
  STATUSES,
  STATUS_KEYS,
  slaDueDates,
  transitionTimestamps,
  validateTransition,
  type Status,
  type TransitionInput,
} from '@/lib/workflow';
import { tasksForCategory } from '@/lib/playbooks';
import { can, RESPONDER_ROLES, type Role } from '@/lib/rbac';
import { zonedDay } from '@/lib/format';

export type Viewer = { id: number; role: Role; email?: string; fullName?: string };
export type Result = { ok: true; message?: string } | { ok: false; error: string };

const nowIso = () => new Date().toISOString();
const link = (id: number) => `/incidents/${id}`;
const isClosed = (s: Status) => s === 'closed' || s === 'rejected';
const NOT_FOUND: Result = { ok: false, error: 'Incident not found.' };
const NOT_PERMITTED: Result = { ok: false, error: 'You are not permitted to perform this action.' };

export const canViewIncident = (user: Viewer, i: Pick<Incident, 'reporterId'>) =>
  can(user, 'incident.view_all') || i.reporterId === user.id;

const loadIncident = async (id: number) => (await getDb()).select().from(incidents).where(eq(incidents.id, id)).get();

async function addEvent(
  tx: Pick<DB, 'insert'>,
  e: { incidentId: number; actorId: number | null; type: EventType; visibility?: 'internal' | 'public'; body?: string | null; meta?: Record<string, unknown>; createdAt?: string },
) {
  await tx.insert(incidentEvents)
    .values({
      incidentId: e.incidentId,
      actorId: e.actorId,
      type: e.type,
      visibility: e.visibility ?? 'internal',
      body: e.body ?? null,
      meta: e.meta ?? {},
      createdAt: e.createdAt ?? nowIso(),
    })
    .run();
}

async function denied(ctx: AuditContext, action: string, incidentId: number, details: Record<string, unknown> = {}): Promise<Result> {
  await recordAudit(ctx, { action: 'access.denied', entityType: 'incident', entityId: incidentId, outcome: 'denied', details: { attempted: action, ...details } });
  return NOT_PERMITTED;
}

const managersAndAssignee = async (i: Incident) => {
  const managers = await (await getDb())
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), eq(users.role, 'manager')))
    .all();
  return [...managers.map((u) => u.id), i.assigneeId];
};

// ───────────────────────────── Listing ─────────────────────────────

export type ListFilters = {
  q?: string;
  status?: string;
  severity?: string;
  category?: string;
  assignee?: string;
  sla?: string;
  sort?: string;
  dir?: string;
  size?: number;
  page?: number;
};
export const PAGE_SIZE = 15;
export const PAGE_SIZES = [10, 15, 25, 50, 100];

/** Sortable columns and the direction each sorts in first. */
export const INCIDENT_SORTS = { reported: 'desc', severity: 'desc', risk: 'desc', due: 'asc', title: 'asc', status: 'asc' } as const;

const severityRank = sql<number>`CASE ${incidents.severity} WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;

export async function listIncidents(user: Viewer, f: ListFilters) {
  const db = await getDb();
  const conds = [];
  if (!can(user, 'incident.view_all')) conds.push(eq(incidents.reporterId, user.id));

  if (f.status === 'open') conds.push(inArray(incidents.status, OPEN_STATUSES));
  else if (f.status === 'closed') conds.push(inArray(incidents.status, ['closed', 'rejected'] as Status[]));
  else if (f.status && (STATUS_KEYS as string[]).includes(f.status)) conds.push(eq(incidents.status, f.status as Status));

  if (f.severity && f.severity in SEVERITIES) conds.push(eq(incidents.severity, f.severity as Severity));
  if (f.category && (CATEGORY_KEYS as string[]).includes(f.category)) conds.push(eq(incidents.category, f.category as Incident['category']));

  if (f.assignee === 'me') conds.push(eq(incidents.assigneeId, user.id));
  else if (f.assignee === 'unassigned') conds.push(isNull(incidents.assigneeId));
  else if (f.assignee && /^\d+$/.test(f.assignee)) conds.push(eq(incidents.assigneeId, Number(f.assignee)));

  if (f.sla === 'overdue') conds.push(and(inArray(incidents.status, OPEN_STATUSES), lt(incidents.slaResolveDueAt, nowIso()))!);

  const q = f.q?.trim();
  if (q) {
    const pattern = `%${q.slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        sql`${incidents.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${incidents.reference} LIKE ${pattern} ESCAPE '\\'`,
        sql`${incidents.description} LIKE ${pattern} ESCAPE '\\'`,
      )!,
    );
  }

  const where = conds.length ? and(...conds) : undefined;
  const total = (await db.select({ n: count() }).from(incidents).where(where).get())!.n;
  const pageSize = PAGE_SIZES.includes(f.size ?? 0) ? f.size! : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, f.page ?? 1), pageCount);

  // Legacy "oldest" link → reported ascending.
  const sortKey = (f.sort === 'oldest' ? 'reported' : f.sort) as keyof typeof INCIDENT_SORTS | undefined;
  const key = sortKey && sortKey in INCIDENT_SORTS ? sortKey : 'reported';
  const dir = f.dir === 'asc' || f.dir === 'desc' ? f.dir : f.sort === 'oldest' ? 'asc' : INCIDENT_SORTS[key];
  const by = dir === 'asc' ? asc : desc;
  const order = {
    reported: [by(incidents.createdAt)],
    severity: [by(severityRank), desc(incidents.createdAt)],
    risk: [by(incidents.riskScore), desc(incidents.createdAt)],
    due: [by(incidents.slaResolveDueAt)],
    title: [by(incidents.title)],
    status: [by(incidents.status), desc(incidents.createdAt)],
  }[key];

  const reporter = alias(users, 'reporter');
  const assignee = alias(users, 'assignee');
  const rows = (await db
    .select({ incident: incidents, reporterName: reporter.fullName, assigneeName: assignee.fullName })
    .from(incidents)
    .innerJoin(reporter, eq(reporter.id, incidents.reporterId))
    .leftJoin(assignee, eq(assignee.id, incidents.assigneeId))
    .where(where)
    .orderBy(...order)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all())
    .map((r) => ({ ...r.incident, reporterName: r.reporterName, assigneeName: r.assigneeName }));

  return { rows, total, page, pageCount, pageSize, sort: key, dir };
}

export type IncidentListRow = Awaited<ReturnType<typeof listIncidents>>['rows'][number];

// ───────────────────────────── Detail ─────────────────────────────

export async function getIncidentDetail(id: number, user: Viewer, ctx: AuditContext) {
  const db = await getDb();
  const incident = await loadIncident(id);
  if (!incident) return null;
  if (!canViewIncident(user, incident)) {
    await denied(ctx, 'incident.view', id);
    return null;
  }
  const staffView = can(user, 'incident.view_all');

  const person = async (uid: number | null) =>
    uid
      ? ((await db
          .select({ id: users.id, fullName: users.fullName, email: users.email, department: users.department, role: users.role })
          .from(users)
          .where(eq(users.id, uid))
          .get()) ?? null)
      : null;

  const actor = alias(users, 'actor');
  const events = (await db
    .select({ event: incidentEvents, actorName: actor.fullName, actorRole: actor.role })
    .from(incidentEvents)
    .leftJoin(actor, eq(actor.id, incidentEvents.actorId))
    .where(staffView ? eq(incidentEvents.incidentId, id) : and(eq(incidentEvents.incidentId, id), eq(incidentEvents.visibility, 'public')))
    .orderBy(asc(incidentEvents.createdAt), asc(incidentEvents.id))
    .all())
    .map((r) => ({ ...r.event, actorName: r.actorName, actorRole: r.actorRole }));

  const tasks = staffView
    ? await db.select().from(incidentTasks).where(eq(incidentTasks.incidentId, id)).orderBy(asc(incidentTasks.sortOrder), asc(incidentTasks.id)).all()
    : [];

  const uploader = alias(users, 'uploader');
  const files = (await db
    .select({ a: attachments, uploaderName: uploader.fullName })
    .from(attachments)
    .leftJoin(uploader, eq(uploader.id, attachments.uploadedBy))
    .where(staffView ? eq(attachments.incidentId, id) : and(eq(attachments.incidentId, id), eq(attachments.uploadedBy, user.id)))
    .orderBy(asc(attachments.id))
    .all())
    .map((r) => ({ ...r.a, uploaderName: r.uploaderName }));

  const auditTrail = can(user, 'incident.audit_trail')
    ? await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, 'incident'), eq(auditLogs.entityId, String(id))))
        .orderBy(desc(auditLogs.id))
        .limit(40)
        .all()
    : [];

  // Access logging for sensitive records, de-duplicated to one entry per user per 15 minutes.
  const recent = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'incident.viewed'),
        eq(auditLogs.entityType, 'incident'),
        eq(auditLogs.entityId, String(id)),
        eq(auditLogs.actorId, user.id),
        gt(auditLogs.ts, new Date(Date.now() - 15 * 60_000).toISOString()),
      ),
    )
    .get();
  if (!recent) await recordAudit(ctx, { action: 'incident.viewed', entityType: 'incident', entityId: id, details: { reference: incident.reference } });

  return { incident, reporter: await person(incident.reporterId), assignee: await person(incident.assigneeId), events, tasks, attachments: files, auditTrail, staffView };
}

export type IncidentDetail = NonNullable<Awaited<ReturnType<typeof getIncidentDetail>>>;

// ───────────────────────────── Create ─────────────────────────────

export type NewIncidentInput = {
  title: string;
  category: RiskInput['category'];
  description: string;
  detectedAt: string;
  department: string;
  affectedAssets: string;
  confidentiality: number;
  integrity: number;
  availability: number;
  dataTypes: RiskInput['dataTypes'];
  scope: RiskInput['scope'];
  ongoing: RiskInput['ongoing'];
};

export async function createIncident(user: Viewer, input: NewIncidentInput, evidence: PreparedEvidence[], ctx: AuditContext, opts: { createdAt?: string } = {}) {
  if (!can(user, 'incident.create')) throw new Error('Not permitted');
  const db = await getDb();
  const ts = opts.createdAt ?? nowIso();
  const cls = classify(input);
  const due = slaDueDates(ts, cls.severity);
  const notifyDue = new Date(Date.parse(ts) + config.compliance.breachNotificationHours * 3_600_000).toISOString();

  // Encrypt evidence up front; ciphertext and metadata are written in the same transaction.
  const sealed = evidence.map(sealEvidence);
  const stored = sealed.map((s) => s.meta);
  const created: { id: number; reference: string } = await db.transaction(async (tx) => {
      const row = await tx
        .insert(incidents)
        .values({
          title: input.title,
          category: cls.input.category,
          description: input.description,
          status: 'new',
          reporterId: user.id,
          department: input.department || null,
          affectedAssets: input.affectedAssets || null,
          detectedAt: input.detectedAt,
          impactConfidentiality: cls.input.confidentiality,
          impactIntegrity: cls.input.integrity,
          impactAvailability: cls.input.availability,
          dataTypes: cls.input.dataTypes,
          affectedScope: cls.input.scope,
          ongoing: cls.input.ongoing,
          riskScore: cls.score,
          computedSeverity: cls.severity,
          severity: cls.severity,
          priority: cls.priority,
          riskFactors: { factors: cls.factors, rules: cls.rules, scoreSeverity: cls.scoreSeverity },
          ...due,
          breachNotifiable: cls.personalDataBreach,
          notificationDueAt: cls.personalDataBreach ? notifyDue : null,
          notificationAuthority: cls.personalDataBreach ? config.compliance.regulatorName : null,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning({ id: incidents.id })
        .get();
      const reference = `INC-${zonedDay(ts).slice(0, 4)}-${String(row.id).padStart(4, '0')}`;
      await tx.update(incidents).set({ reference }).where(eq(incidents.id, row.id)).run();

      const tasks = tasksForCategory(cls.input.category);
      await tx.insert(incidentTasks).values(tasks.map((t) => ({ incidentId: row.id, phase: t.phase, title: t.title, sortOrder: t.sortOrder, createdAt: ts }))).run();
      if (sealed.length) {
        await tx.insert(evidenceBlobs).values(sealed.map((s) => ({ storedName: s.meta.storedName, data: s.ciphertext, createdAt: ts }))).run();
        await tx.insert(attachments).values(stored.map((s) => ({ incidentId: row.id, uploadedBy: user.id, ...s, createdAt: ts }))).run();
      }
      await addEvent(tx, {
        incidentId: row.id,
        actorId: user.id,
        type: 'created',
        visibility: 'public',
        body: 'Incident reported.',
        meta: { severity: cls.severity, score: cls.score, evidence: stored.length },
        createdAt: ts,
      });
      return { id: row.id, reference };
  });

  await recordAudit(ctx, {
    action: 'incident.created',
    entityType: 'incident',
    entityId: created.id,
    details: {
      reference: created.reference,
      category: cls.input.category,
      severity: cls.severity,
      riskScore: cls.score,
      rulesApplied: cls.rules.map((r) => r.id),
      personalDataBreach: cls.personalDataBreach,
      evidence: stored.map((s) => ({ name: s.originalName, sha256: s.sha256 })),
    },
  });

  const sevLabel = SEVERITIES[cls.severity].label;
  await notifyRoles(cls.severity === 'critical' ? ['analyst', 'manager', 'admin'] : ['analyst', 'manager'], {
    message: `New ${sevLabel} incident ${created.reference}: ${input.title}`,
    incidentId: created.id,
    link: link(created.id),
    excludeUserId: user.id,
  });
  return { ...created, classification: cls };
}

// ───────────────────────────── Workflow ─────────────────────────────

export async function transitionIncident(id: number, to: Status, input: TransitionInput, user: Viewer, ctx: AuditContext): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(id);
  if (!i) return NOT_FOUND;
  if (!can(user, 'incident.triage')) return denied(ctx, 'incident.transition', id);

  const openTasks = (await db
    .select({ n: count() })
    .from(incidentTasks)
    .where(and(eq(incidentTasks.incidentId, id), eq(incidentTasks.status, 'open')))
    .get())!.n;
  const errors = validateTransition(i, to, user, input, { openTasks });
  if (errors.length) {
    await recordAudit(ctx, { action: 'incident.transition_rejected', entityType: 'incident', entityId: id, outcome: 'failure', details: { from: i.status, to, errors } });
    return { ok: false, error: errors.join(' ') };
  }

  const ts = nowIso();
  const note = input.note?.trim() || null;
  await db.transaction(async (tx) => {
    await tx.update(incidents)
      .set({
        status: to,
        updatedAt: ts,
        ...transitionTimestamps(i, to, ts),
        ...(to === 'closed'
          ? {
              resolutionSummary: input.resolutionSummary?.trim(),
              rootCause: input.rootCause?.trim(),
              lessonsLearned: input.lessonsLearned?.trim() || null,
            }
          : {}),
      })
      .where(eq(incidents.id, id))
      .run();
    await addEvent(tx, { incidentId: id, actorId: user.id, type: 'status_change', visibility: 'public', body: note, meta: { from: i.status, to }, createdAt: ts });
  });

  await recordAudit(ctx, { action: 'incident.status_changed', entityType: 'incident', entityId: id, details: { reference: i.reference, from: i.status, to, note } });
  await notifyUsers([i.reporterId], {
    message: `Your report ${i.reference} is now "${STATUSES[to].label}".`,
    incidentId: id,
    link: link(id),
    excludeUserId: user.id,
  });
  await notifyUsers([i.assigneeId], {
    message: `${i.reference} moved to "${STATUSES[to].label}".`,
    incidentId: id,
    link: link(id),
    excludeUserId: user.id,
  });
  return { ok: true, message: `Status changed to ${STATUSES[to].label}.` };
}

export async function assignIncident(id: number, assigneeId: number | null, user: Viewer, ctx: AuditContext): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(id);
  if (!i) return NOT_FOUND;
  const selfAssign = assigneeId === user.id;
  if (!(can(user, 'incident.assign') || (selfAssign && can(user, 'incident.assign_self')))) return denied(ctx, 'incident.assign', id);
  if (isClosed(i.status)) return { ok: false, error: 'Reopen the incident before changing the assignment.' };

  let assigneeName: string | null = null;
  if (assigneeId !== null) {
    const a = await db.select().from(users).where(eq(users.id, assigneeId)).get();
    if (!a || !a.isActive || !RESPONDER_ROLES.includes(a.role)) return { ok: false, error: 'Incidents can only be assigned to active responders.' };
    assigneeName = a.fullName;
  }
  if (i.assigneeId === assigneeId) return { ok: true, message: 'No change.' };

  const ts = nowIso();
  await db.transaction(async (tx) => {
    await tx.update(incidents).set({ assigneeId, updatedAt: ts }).where(eq(incidents.id, id)).run();
    await addEvent(tx, {
      incidentId: id,
      actorId: user.id,
      type: 'assignment',
      body: assigneeName ? `Assigned to ${assigneeName}.` : 'Assignment removed.',
      meta: { from: i.assigneeId, to: assigneeId },
      createdAt: ts,
    });
  });
  await recordAudit(ctx, { action: 'incident.assigned', entityType: 'incident', entityId: id, details: { reference: i.reference, from: i.assigneeId, to: assigneeId } });
  await notifyUsers([assigneeId], { message: `${i.reference} has been assigned to you: ${i.title}`, incidentId: id, link: link(id), excludeUserId: user.id });
  return { ok: true, message: assigneeName ? `Assigned to ${assigneeName}.` : 'Assignment removed.' };
}

// ───────────────────────────── Classification ─────────────────────────────

export async function reassessIncident(id: number, input: RiskInput, user: Viewer, ctx: AuditContext): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(id);
  if (!i) return NOT_FOUND;
  if (!can(user, 'incident.triage')) return denied(ctx, 'incident.reassess', id);
  if (isClosed(i.status)) return { ok: false, error: 'Closed incidents cannot be re-assessed. Reopen it first.' };

  const cls = classify(input);
  const severity = i.severityOverridden ? i.severity : cls.severity;
  const ts = nowIso();
  const becomesNotifiable = cls.personalDataBreach && !i.breachNotifiable;

  await db.transaction(async (tx) => {
    await tx.update(incidents)
      .set({
        category: cls.input.category,
        impactConfidentiality: cls.input.confidentiality,
        impactIntegrity: cls.input.integrity,
        impactAvailability: cls.input.availability,
        dataTypes: cls.input.dataTypes,
        affectedScope: cls.input.scope,
        ongoing: cls.input.ongoing,
        riskScore: cls.score,
        computedSeverity: cls.severity,
        severity,
        priority: SEVERITIES[severity].priority,
        riskFactors: { factors: cls.factors, rules: cls.rules, scoreSeverity: cls.scoreSeverity },
        ...slaDueDates(i.createdAt, severity),
        ...(becomesNotifiable
          ? {
              breachNotifiable: true,
              notificationDueAt: new Date(Date.parse(i.createdAt) + config.compliance.breachNotificationHours * 3_600_000).toISOString(),
              notificationAuthority: config.compliance.regulatorName,
            }
          : {}),
        updatedAt: ts,
      })
      .where(eq(incidents.id, id))
      .run();

    // A new category brings its playbook tasks with it (without duplicating existing ones).
    if (cls.input.category !== i.category) {
      const current = await tx.select({ title: incidentTasks.title }).from(incidentTasks).where(eq(incidentTasks.incidentId, id)).all();
      const existing = new Set(current.map((t) => t.title));
      const extra = tasksForCategory(cls.input.category).filter((t) => !existing.has(t.title));
      if (extra.length) await tx.insert(incidentTasks).values(extra.map((t) => ({ incidentId: id, phase: t.phase, title: t.title, sortOrder: 100 + t.sortOrder, createdAt: ts }))).run();
    }
    await addEvent(tx, {
      incidentId: id,
      actorId: user.id,
      type: 'classification',
      body: `Risk re-assessed: score ${i.riskScore} → ${cls.score}, severity ${SEVERITIES[i.severity].label} → ${SEVERITIES[severity].label}${i.severityOverridden ? ' (manual override kept)' : ''}.`,
      meta: { fromScore: i.riskScore, toScore: cls.score, fromSeverity: i.severity, toSeverity: severity },
      createdAt: ts,
    });
    if (becomesNotifiable) {
      await addEvent(tx, { incidentId: id, actorId: null, type: 'compliance', body: 'Flagged as a notifiable personal-data breach (72-hour regulator deadline).', createdAt: ts });
    }
  });

  await recordAudit(ctx, {
    action: 'incident.reassessed',
    entityType: 'incident',
    entityId: id,
    details: {
      reference: i.reference,
      before: { category: i.category, score: i.riskScore, severity: i.severity },
      after: { category: cls.input.category, score: cls.score, severity },
      becameNotifiable: becomesNotifiable,
    },
  });
  if (SEVERITIES[severity].rank > SEVERITIES[i.severity].rank && severity === 'critical') {
    await notifyRoles(['manager'], { message: `${i.reference} escalated to Critical.`, incidentId: id, link: link(id), excludeUserId: user.id });
  }
  return { ok: true, message: `Re-assessed: risk score ${cls.score}, severity ${SEVERITIES[severity].label}.` };
}

export async function overrideSeverity(id: number, target: Severity | 'revert', reason: string, user: Viewer, ctx: AuditContext): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(id);
  if (!i) return NOT_FOUND;
  if (!can(user, 'incident.override')) return denied(ctx, 'incident.override', id);
  if (isClosed(i.status)) return { ok: false, error: 'Closed incidents cannot be re-classified. Reopen it first.' };
  if (reason.trim().length < 10) return { ok: false, error: 'Give a justification of at least 10 characters.' };

  const severity: Severity = target === 'revert' ? i.computedSeverity : target;
  const ts = nowIso();
  await db.transaction(async (tx) => {
    await tx.update(incidents)
      .set({
        severity,
        priority: SEVERITIES[severity].priority,
        severityOverridden: target !== 'revert',
        overrideReason: target === 'revert' ? null : reason.trim(),
        ...slaDueDates(i.createdAt, severity),
        updatedAt: ts,
      })
      .where(eq(incidents.id, id))
      .run();
    await addEvent(tx, {
      incidentId: id,
      actorId: user.id,
      type: 'classification',
      body:
        target === 'revert'
          ? `Manual override removed; severity returned to calculated ${SEVERITIES[severity].label}. Reason: ${reason.trim()}`
          : `Severity manually set to ${SEVERITIES[severity].label} (calculated: ${SEVERITIES[i.computedSeverity].label}). Reason: ${reason.trim()}`,
      meta: { from: i.severity, to: severity, computed: i.computedSeverity },
      createdAt: ts,
    });
  });
  await recordAudit(ctx, {
    action: target === 'revert' ? 'incident.override_removed' : 'incident.severity_overridden',
    entityType: 'incident',
    entityId: id,
    details: { reference: i.reference, from: i.severity, to: severity, computed: i.computedSeverity, reason: reason.trim() },
  });
  return { ok: true, message: `Severity is now ${SEVERITIES[severity].label}.` };
}

// ───────────────────────────── Collaboration ─────────────────────────────

export async function addComment(id: number, body: string, visibility: 'internal' | 'public', user: Viewer, ctx: AuditContext): Promise<Result> {
  const i = await loadIncident(id);
  if (!i) return NOT_FOUND;
  if (!canViewIncident(user, i)) return denied(ctx, 'incident.comment', id);
  if (!can(user, 'incident.comment')) return denied(ctx, 'incident.comment', id);

  const responder = can(user, 'incident.triage');
  const vis = responder ? visibility : 'public'; // reporters can only post messages the team will see
  await addEvent(await getDb(), { incidentId: id, actorId: user.id, type: 'comment', visibility: vis, body });
  await recordAudit(ctx, { action: 'incident.comment_added', entityType: 'incident', entityId: id, details: { reference: i.reference, visibility: vis, length: body.length } });

  if (!responder) {
    const recipients = i.assigneeId ? [i.assigneeId] : await managersAndAssignee(i);
    await notifyUsers(recipients, { message: `New message from the reporter on ${i.reference}.`, incidentId: id, link: link(id), excludeUserId: user.id });
  } else if (vis === 'public') {
    await notifyUsers([i.reporterId], { message: `The security team replied on your report ${i.reference}.`, incidentId: id, link: link(id), excludeUserId: user.id });
  } else {
    await notifyUsers([i.assigneeId], { message: `New internal note on ${i.reference}.`, incidentId: id, link: link(id), excludeUserId: user.id });
  }
  return { ok: true, message: vis === 'public' ? 'Message posted.' : 'Internal note added.' };
}

export async function updateTaskStatus(incidentId: number, taskId: number, status: TaskStatus, user: Viewer, ctx: AuditContext): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(incidentId);
  if (!i) return NOT_FOUND;
  if (!can(user, 'incident.triage')) return denied(ctx, 'incident.task', incidentId);
  if (isClosed(i.status)) return { ok: false, error: 'Tasks on a closed incident cannot be changed.' };
  const task = await db.select().from(incidentTasks).where(and(eq(incidentTasks.id, taskId), eq(incidentTasks.incidentId, incidentId))).get();
  if (!task) return { ok: false, error: 'Task not found.' };
  if (task.status === status) return { ok: true };

  const ts = nowIso();
  const label = { open: 'reopened', done: 'completed', not_applicable: 'marked not applicable' }[status];
  await db.transaction(async (tx) => {
    await tx.update(incidentTasks)
      .set({ status, completedBy: status === 'open' ? null : user.id, completedAt: status === 'open' ? null : ts })
      .where(eq(incidentTasks.id, taskId))
      .run();
    await addEvent(tx, { incidentId, actorId: user.id, type: 'task', body: `Task ${label}: ${task.title}`, meta: { taskId, from: task.status, to: status }, createdAt: ts });
  });
  await recordAudit(ctx, { action: 'incident.task_updated', entityType: 'incident', entityId: incidentId, details: { taskId, title: task.title, from: task.status, to: status } });
  return { ok: true };
}

export async function addTask(incidentId: number, title: string, phase: string, user: Viewer, ctx: AuditContext): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(incidentId);
  if (!i) return NOT_FOUND;
  if (!can(user, 'incident.triage')) return denied(ctx, 'incident.task', incidentId);
  if (isClosed(i.status)) return { ok: false, error: 'Reopen the incident before adding tasks.' };
  const ts = nowIso();
  const max = (await db.select({ m: sql<number>`COALESCE(MAX(${incidentTasks.sortOrder}), 0)` }).from(incidentTasks).where(eq(incidentTasks.incidentId, incidentId)).get())!.m;
  await db.transaction(async (tx) => {
    await tx.insert(incidentTasks).values({ incidentId, phase, title, sortOrder: max + 1, createdAt: ts }).run();
    await addEvent(tx, { incidentId, actorId: user.id, type: 'task', body: `Task added: ${title}`, createdAt: ts });
  });
  await recordAudit(ctx, { action: 'incident.task_added', entityType: 'incident', entityId: incidentId, details: { title, phase } });
  return { ok: true, message: 'Task added.' };
}

// ───────────────────────────── Evidence ─────────────────────────────

export async function attachEvidence(incidentId: number, evidence: PreparedEvidence[], user: Viewer, ctx: AuditContext): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(incidentId);
  if (!i) return NOT_FOUND;
  if (!canViewIncident(user, i) || !can(user, 'incident.comment')) return denied(ctx, 'evidence.upload', incidentId);
  if (isClosed(i.status)) return { ok: false, error: 'Evidence cannot be added to a closed incident.' };
  if (!evidence.length) return { ok: false, error: 'Choose at least one file.' };

  const sealed = evidence.map(sealEvidence);
  const stored = sealed.map((s) => s.meta);
  const ts = nowIso();
  const fromReporter = !can(user, 'incident.view_all');
  await db.transaction(async (tx) => {
    await tx.insert(evidenceBlobs).values(sealed.map((s) => ({ storedName: s.meta.storedName, data: s.ciphertext, createdAt: ts }))).run();
    await tx.insert(attachments).values(stored.map((s) => ({ incidentId, uploadedBy: user.id, ...s, createdAt: ts }))).run();
    await addEvent(tx, {
      incidentId,
      actorId: user.id,
      type: 'attachment',
      visibility: fromReporter ? 'public' : 'internal',
      body: `Evidence added: ${stored.map((s) => s.originalName).join(', ')}`,
      createdAt: ts,
    });
  });
  await recordAudit(ctx, {
    action: 'evidence.uploaded',
    entityType: 'incident',
    entityId: incidentId,
    details: { files: stored.map((s) => ({ name: s.originalName, sha256: s.sha256, bytes: s.sizeBytes })) },
  });
  if (fromReporter) await notifyUsers([i.assigneeId], { message: `New evidence uploaded to ${i.reference}.`, incidentId, link: link(incidentId), excludeUserId: user.id });
  return { ok: true, message: `${stored.length} file(s) uploaded and encrypted.` };
}

export async function getEvidenceForDownload(incidentId: number, attachmentId: number, user: Viewer, ctx: AuditContext) {
  const db = await getDb();
  const i = await loadIncident(incidentId);
  if (!i) return null;
  const a = await db.select().from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.incidentId, incidentId))).get();
  if (!a) return null;
  if (!canViewIncident(user, i) || (!can(user, 'incident.view_all') && a.uploadedBy !== user.id)) {
    await denied(ctx, 'evidence.download', incidentId, { attachmentId });
    return null;
  }
  try {
    const data = await readEvidence(a);
    await recordAudit(ctx, { action: 'evidence.downloaded', entityType: 'incident', entityId: incidentId, details: { attachmentId, name: a.originalName, sha256: a.sha256 } });
    return { attachment: a, data };
  } catch (err) {
    await recordAudit(ctx, {
      action: 'evidence.integrity_failed',
      entityType: 'incident',
      entityId: incidentId,
      outcome: 'failure',
      details: { attachmentId, name: a.originalName, error: (err as Error).message },
    });
    throw err;
  }
}

// ───────────────────────────── Compliance ─────────────────────────────

export async function setBreachNotifiable(id: number, notifiable: boolean, reason: string, user: Viewer, ctx: AuditContext): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(id);
  if (!i) return NOT_FOUND;
  if (!can(user, 'incident.compliance')) return denied(ctx, 'incident.breach_assessment', id);
  if (reason.trim().length < 10) return { ok: false, error: 'Record the reasoning for this decision (at least 10 characters).' };
  if (i.notifiedAt && !notifiable) return { ok: false, error: 'The regulator has already been notified for this incident.' };

  const ts = nowIso();
  await db.transaction(async (tx) => {
    await tx.update(incidents)
      .set({
        breachNotifiable: notifiable,
        notificationDueAt: notifiable
          ? i.notificationDueAt ?? new Date(Date.parse(i.createdAt) + config.compliance.breachNotificationHours * 3_600_000).toISOString()
          : null,
        notificationAuthority: notifiable ? i.notificationAuthority ?? config.compliance.regulatorName : null,
        updatedAt: ts,
      })
      .where(eq(incidents.id, id))
      .run();
    await addEvent(tx, {
      incidentId: id,
      actorId: user.id,
      type: 'compliance',
      body: `${notifiable ? 'Assessed as a notifiable' : 'Assessed as NOT a notifiable'} personal-data breach. Reason: ${reason.trim()}`,
      createdAt: ts,
    });
  });
  await recordAudit(ctx, { action: 'incident.breach_assessed', entityType: 'incident', entityId: id, details: { reference: i.reference, notifiable, reason: reason.trim() } });
  return { ok: true, message: 'Breach assessment recorded.' };
}

export async function recordRegulatorNotification(
  id: number,
  input: { notifiedAt: string; authority: string; reference: string },
  user: Viewer,
  ctx: AuditContext,
): Promise<Result> {
  const db = await getDb();
  const i = await loadIncident(id);
  if (!i) return NOT_FOUND;
  if (!can(user, 'incident.compliance')) return denied(ctx, 'incident.regulator_notification', id);
  if (!i.breachNotifiable) return { ok: false, error: 'This incident is not flagged as a notifiable breach.' };
  if (Date.parse(input.notifiedAt) > Date.now() + 5 * 60_000) return { ok: false, error: 'Notification time cannot be in the future.' };

  const onTime = !i.notificationDueAt || input.notifiedAt <= i.notificationDueAt;
  const ts = nowIso();
  await db.transaction(async (tx) => {
    await tx.update(incidents)
      .set({ notifiedAt: input.notifiedAt, notificationAuthority: input.authority, notificationRef: input.reference, updatedAt: ts })
      .where(eq(incidents.id, id))
      .run();
    await addEvent(tx, {
      incidentId: id,
      actorId: user.id,
      type: 'compliance',
      body: `Regulator notified: ${input.authority} (ref. ${input.reference})${onTime ? '' : '. Filed after the 72-hour deadline.'}`,
      createdAt: ts,
    });
  });
  await recordAudit(ctx, {
    action: 'incident.regulator_notified',
    entityType: 'incident',
    entityId: id,
    details: { reference: i.reference, authority: input.authority, regulatorRef: input.reference, notifiedAt: input.notifiedAt, onTime },
  });
  return { ok: true, message: 'Regulator notification recorded.' };
}

// ───────────────────────────── SLA escalation ─────────────────────────────

/**
 * Escalate incidents that have breached their acknowledgement or resolution
 * SLA. Runs on a timer (instrumentation.ts) and opportunistically when the
 * dashboard loads. Each breach is escalated once (tracked in sla_breach_flags).
 */
export async function runSlaEscalations(): Promise<number> {
  const db = await getDb();
  const now = nowIso();
  const candidates = await db
    .select()
    .from(incidents)
    .where(
      and(
        inArray(incidents.status, OPEN_STATUSES),
        or(
          and(isNull(incidents.acknowledgedAt), lt(incidents.slaAckDueAt, now), sql`(${incidents.slaBreachFlags} & 1) = 0`),
          and(lt(incidents.slaResolveDueAt, now), sql`(${incidents.slaBreachFlags} & 2) = 0`),
        ),
      ),
    )
    .all();

  let escalated = 0;
  for (const i of candidates) {
    const ackBreach = !i.acknowledgedAt && i.slaAckDueAt < now && (i.slaBreachFlags & 1) === 0;
    const resolveBreach = i.slaResolveDueAt < now && (i.slaBreachFlags & 2) === 0;
    const flags = i.slaBreachFlags | (ackBreach ? 1 : 0) | (resolveBreach ? 2 : 0);
    const kind = resolveBreach ? 'resolution' : 'acknowledgement';
    // Compare-and-set on the flags: if another instance escalated this incident
    // a moment ago, the update matches no row and we skip it (no duplicates).
    const claimed = await db.transaction(async (tx) => {
      const res = await tx
        .update(incidents)
        .set({ slaBreachFlags: flags })
        .where(and(eq(incidents.id, i.id), eq(incidents.slaBreachFlags, i.slaBreachFlags)))
        .run();
      if (res.rowsAffected !== 1) return false;
      await addEvent(tx, { incidentId: i.id, actorId: null, type: 'sla', body: `SLA breached: ${kind} deadline passed. Escalated to security managers.` });
      return true;
    });
    if (!claimed) continue;
    escalated++;
    await recordAudit({ actor: null }, { action: 'incident.sla_breached', entityType: 'incident', entityId: i.id, outcome: 'failure', details: { reference: i.reference, kind, severity: i.severity } });
    await notifyUsers(await managersAndAssignee(i), { message: `SLA breached on ${i.reference} (${SEVERITIES[i.severity].label}): ${kind} overdue.`, incidentId: i.id, link: link(i.id) });
  }
  return escalated;
}

let lastSweep = 0;
/** Escalation at most once a minute per instance; used where serverless hosts lack timers. */
export async function maybeRunSlaEscalations() {
  if (Date.now() - lastSweep < 60_000) return 0;
  lastSweep = Date.now();
  return runSlaEscalations();
}

// ───────────────────────────── Reporter summary ─────────────────────────────

export async function reporterSummary(userId: number) {
  const db = await getDb();
  const mine = await db.select().from(incidents).where(eq(incidents.reporterId, userId)).orderBy(desc(incidents.createdAt)).all();
  return {
    total: mine.length,
    open: mine.filter((i) => STATUSES[i.status].open).length,
    resolved: mine.filter((i) => i.status === 'closed').length,
    recent: mine.slice(0, 6),
  };
}

export { CATEGORIES };
