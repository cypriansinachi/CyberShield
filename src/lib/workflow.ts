/**
 * Incident response workflow: a finite-state machine modelled on the
 * NIST SP 800-61 incident handling lifecycle.
 *
 *   new → triaged → investigating → contained → eradicated → recovered → closed
 *    └──────┴────────────┴──→ rejected (false positive / duplicate)
 *   contained / eradicated / recovered → investigating   (new findings)
 *   closed → investigating, rejected → triaged           (reopen, managers only)
 *
 * Transitions are always validated on the server. The UI only offers legal
 * moves, but the server never trusts the UI.
 */
import { SEVERITIES, type Severity } from './risk';
import { can, type Role } from './rbac';

export const STATUSES = {
  new: { label: 'New', phase: 'Detection & Analysis', open: true },
  triaged: { label: 'Triaged', phase: 'Detection & Analysis', open: true },
  investigating: { label: 'Investigating', phase: 'Detection & Analysis', open: true },
  contained: { label: 'Contained', phase: 'Containment, Eradication & Recovery', open: true },
  eradicated: { label: 'Eradicated', phase: 'Containment, Eradication & Recovery', open: true },
  recovered: { label: 'Recovered', phase: 'Containment, Eradication & Recovery', open: true },
  closed: { label: 'Closed', phase: 'Post-Incident Activity', open: false },
  rejected: { label: 'Rejected', phase: 'Not an incident', open: false },
} as const;
export type Status = keyof typeof STATUSES;
export const STATUS_KEYS = Object.keys(STATUSES) as Status[];
export const OPEN_STATUSES = STATUS_KEYS.filter((s) => STATUSES[s].open);
export const LIFECYCLE: Status[] = ['new', 'triaged', 'investigating', 'contained', 'eradicated', 'recovered', 'closed'];

export const TRANSITIONS: Record<Status, Status[]> = {
  new: ['triaged', 'rejected'],
  triaged: ['investigating', 'rejected'],
  investigating: ['contained', 'rejected'],
  contained: ['eradicated', 'investigating'],
  eradicated: ['recovered', 'investigating'],
  recovered: ['closed', 'investigating'],
  closed: ['investigating'],
  rejected: ['triaged'],
};

export const isReopen = (from: Status) => from === 'closed' || from === 'rejected';
export const isMajorSeverity = (s: Severity) => s === 'high' || s === 'critical';

export function transitionLabel(from: Status, to: Status): string {
  if (from === 'closed' && to === 'investigating') return 'Reopen incident';
  if (from === 'rejected' && to === 'triaged') return 'Reopen report';
  if (to === 'investigating' && (from === 'contained' || from === 'eradicated' || from === 'recovered')) {
    return 'Return to investigation';
  }
  const labels: Partial<Record<Status, string>> = {
    triaged: 'Acknowledge & triage',
    investigating: 'Start investigation',
    contained: 'Mark as contained',
    eradicated: 'Mark threat eradicated',
    recovered: 'Mark systems recovered',
    closed: 'Close incident',
    rejected: 'Reject as false positive / duplicate',
  };
  return labels[to] ?? STATUSES[to].label;
}

/** Which extra inputs a transition needs (drives the UI form). */
export function transitionRequirements(from: Status, to: Status, severity: Severity) {
  return {
    note: to === 'rejected' || isReopen(from),
    closure: to === 'closed',
    lessons: to === 'closed' && isMajorSeverity(severity),
  };
}

export type TransitionIncident = {
  status: Status;
  severity: Severity;
  assigneeId: number | null;
  breachNotifiable: boolean;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  containedAt: string | null;
};

export type TransitionInput = {
  note?: string;
  resolutionSummary?: string;
  rootCause?: string;
  lessonsLearned?: string;
};

/** Validate a transition. Returns human-readable errors (empty array = allowed). */
export function validateTransition(
  incident: TransitionIncident,
  to: Status,
  user: { role: Role },
  input: TransitionInput = {},
  ctx: { openTasks?: number } = {},
): string[] {
  const from = incident.status;
  if (!STATUSES[to]) return ['Unknown target status.'];
  if (!TRANSITIONS[from].includes(to)) {
    return [`An incident cannot move from "${STATUSES[from].label}" to "${STATUSES[to].label}".`];
  }
  if (!can(user, 'incident.triage')) return ['You are not permitted to change incident status.'];
  if (isReopen(from) && !can(user, 'incident.reopen')) {
    return ['Only a security manager or administrator can reopen a closed incident.'];
  }

  const errors: string[] = [];
  const note = (input.note ?? '').trim();
  if (to === 'investigating' && !incident.assigneeId) {
    errors.push('Assign the incident to a responder before starting the investigation.');
  }
  if ((to === 'rejected' || isReopen(from)) && note.length < 10) {
    errors.push('Provide a justification of at least 10 characters.');
  }
  if (to === 'closed') {
    const major = isMajorSeverity(incident.severity);
    if (major && !can(user, 'incident.close_major')) {
      errors.push('High and Critical incidents must be closed by a security manager (four-eyes principle).');
    }
    if ((input.resolutionSummary ?? '').trim().length < 20) errors.push('Resolution summary must be at least 20 characters.');
    if ((input.rootCause ?? '').trim().length < 10) errors.push('Root cause must be at least 10 characters.');
    if (major && (input.lessonsLearned ?? '').trim().length < 10) {
      errors.push('Lessons learned are mandatory for High and Critical incidents (ISO/IEC 27001 A.5.27).');
    }
    if ((ctx.openTasks ?? 0) > 0) {
      errors.push(`${ctx.openTasks} response task(s) are still open. Complete them or mark them not applicable.`);
    }
    if (incident.breachNotifiable && !incident.notifiedAt) {
      errors.push('This is a notifiable personal-data breach. Record the regulator notification before closing.');
    }
  }
  return errors;
}

/** Timestamp side-effects of entering a status. */
export function transitionTimestamps(incident: TransitionIncident, to: Status, now: string) {
  const patch: Partial<{
    acknowledgedAt: string;
    containedAt: string;
    recoveredAt: string;
    closedAt: string | null;
    slaBreachFlags: number;
  }> = {};
  if ((to === 'triaged' || to === 'rejected') && !incident.acknowledgedAt) patch.acknowledgedAt = now;
  if (to === 'contained' && !incident.containedAt) patch.containedAt = now;
  if (to === 'recovered') patch.recoveredAt = now;
  if (to === 'closed' || to === 'rejected') patch.closedAt = now;
  if (isReopen(incident.status)) {
    patch.closedAt = null;
    patch.slaBreachFlags = 0;
  }
  return patch;
}

export function slaDueDates(createdAtIso: string, severity: Severity) {
  const base = new Date(createdAtIso).getTime();
  const s = SEVERITIES[severity];
  return {
    slaAckDueAt: new Date(base + s.ackMinutes * 60_000).toISOString(),
    slaResolveDueAt: new Date(base + s.resolveHours * 3_600_000).toISOString(),
  };
}

export type SlaState = 'met' | 'missed' | 'overdue' | 'pending' | 'at_risk' | 'on_track' | 'n/a';

/** SLA status for display. The resolution SLA is measured to closure. */
export function slaStatus(
  i: {
    status: Status;
    createdAt: string;
    acknowledgedAt: string | null;
    closedAt: string | null;
    slaAckDueAt: string;
    slaResolveDueAt: string;
  },
  now = Date.now(),
): { ack: SlaState; resolve: SlaState; remainingMs: number } {
  const ackDue = Date.parse(i.slaAckDueAt);
  const resolveDue = Date.parse(i.slaResolveDueAt);
  const created = Date.parse(i.createdAt);

  let ack: SlaState;
  if (i.acknowledgedAt) ack = Date.parse(i.acknowledgedAt) <= ackDue ? 'met' : 'missed';
  else ack = now > ackDue ? 'overdue' : 'pending';

  let resolve: SlaState;
  if (i.status === 'rejected') resolve = 'n/a';
  else if (i.closedAt) resolve = Date.parse(i.closedAt) <= resolveDue ? 'met' : 'missed';
  else if (now > resolveDue) resolve = 'overdue';
  else if ((resolveDue - now) / (resolveDue - created) < 0.25) resolve = 'at_risk';
  else resolve = 'on_track';

  return { ack, resolve, remainingMs: resolveDue - now };
}
