import { describe, expect, it } from 'vitest';
import { slaDueDates, slaStatus, transitionTimestamps, validateTransition, type TransitionIncident } from '@/lib/workflow';
import { can, ROLE_KEYS, type Role } from '@/lib/rbac';

const inc = (over: Partial<TransitionIncident> = {}): TransitionIncident => ({
  status: 'new',
  severity: 'medium',
  assigneeId: 7,
  breachNotifiable: false,
  notifiedAt: null,
  acknowledgedAt: null,
  containedAt: null,
  ...over,
});
const as = (role: Role) => ({ role });
const closure = { resolutionSummary: 'Blocked the sender and purged the messages.', rootCause: 'Look-alike domain', lessonsLearned: 'Enable look-alike detection' };

describe('response workflow state machine', () => {
  it('allows legal transitions for responders', () => {
    expect(validateTransition(inc(), 'triaged', as('analyst'))).toEqual([]);
    expect(validateTransition(inc({ status: 'triaged' }), 'investigating', as('analyst'))).toEqual([]);
  });

  it('rejects skipping lifecycle stages', () => {
    expect(validateTransition(inc(), 'closed', as('manager'), closure)[0]).toMatch(/cannot move/);
  });

  it('denies status changes to reporters and auditors', () => {
    expect(validateTransition(inc(), 'triaged', as('reporter'))[0]).toMatch(/not permitted/);
    expect(validateTransition(inc(), 'triaged', as('auditor'))[0]).toMatch(/not permitted/);
  });

  it('requires an assignee before investigation and a justification to reject', () => {
    expect(validateTransition(inc({ status: 'triaged', assigneeId: null }), 'investigating', as('analyst')).join()).toMatch(/Assign/);
    expect(validateTransition(inc(), 'rejected', as('analyst'), { note: 'dup' }).join()).toMatch(/justification/);
  });

  it('enforces closure requirements', () => {
    const recovered = inc({ status: 'recovered' });
    expect(validateTransition(recovered, 'closed', as('analyst'), {}).length).toBeGreaterThanOrEqual(2);
    expect(validateTransition(recovered, 'closed', as('analyst'), closure)).toEqual([]);
    expect(validateTransition(recovered, 'closed', as('analyst'), closure, { openTasks: 2 }).join()).toMatch(/2 response task/);
  });

  it('applies four-eyes and lessons-learned rules to major incidents', () => {
    const major = inc({ status: 'recovered', severity: 'critical' });
    expect(validateTransition(major, 'closed', as('analyst'), closure).join()).toMatch(/security manager/);
    expect(validateTransition(major, 'closed', as('manager'), { ...closure, lessonsLearned: '' }).join()).toMatch(/Lessons learned/);
    expect(validateTransition(major, 'closed', as('manager'), closure)).toEqual([]);
  });

  it('blocks closure of a notifiable breach until the regulator is notified', () => {
    const breach = inc({ status: 'recovered', breachNotifiable: true });
    expect(validateTransition(breach, 'closed', as('manager'), closure).join()).toMatch(/regulator/);
    expect(validateTransition({ ...breach, notifiedAt: new Date().toISOString() }, 'closed', as('manager'), closure)).toEqual([]);
  });

  it('only lets managers reopen closed incidents', () => {
    const closed = inc({ status: 'closed' });
    expect(validateTransition(closed, 'investigating', as('analyst'), { note: 'New evidence found' })[0]).toMatch(/Only a security manager/);
    expect(validateTransition(closed, 'investigating', as('manager'), { note: 'New evidence found' })).toEqual([]);
  });

  it('records lifecycle timestamps', () => {
    const now = '2026-01-01T10:00:00.000Z';
    expect(transitionTimestamps(inc(), 'triaged', now)).toMatchObject({ acknowledgedAt: now });
    expect(transitionTimestamps(inc({ status: 'closed' }), 'investigating', now)).toMatchObject({ closedAt: null, slaBreachFlags: 0 });
  });

  it('computes SLA deadlines and states', () => {
    const created = '2026-01-01T00:00:00.000Z';
    const due = slaDueDates(created, 'critical');
    expect(due.slaAckDueAt).toBe('2026-01-01T00:15:00.000Z');
    expect(due.slaResolveDueAt).toBe('2026-01-02T00:00:00.000Z');
    const base = { status: 'investigating' as const, createdAt: created, acknowledgedAt: null, closedAt: null, ...due };
    expect(slaStatus(base, Date.parse('2026-01-01T00:10:00Z')).ack).toBe('pending');
    expect(slaStatus(base, Date.parse('2026-01-01T00:20:00Z')).ack).toBe('overdue');
    expect(slaStatus(base, Date.parse('2026-01-01T20:00:00Z')).resolve).toBe('at_risk');
    expect(slaStatus(base, Date.parse('2026-01-02T01:00:00Z')).resolve).toBe('overdue');
  });
});

describe('role-based access control (least privilege)', () => {
  const matrix: Record<string, Role[]> = {
    'incident.view_all': ['analyst', 'manager', 'admin', 'auditor'],
    'incident.triage': ['analyst', 'manager', 'admin'],
    'incident.override': ['manager', 'admin'],
    'audit.view': ['admin', 'auditor'],
    'user.manage': ['admin'],
    'incident.create': ['reporter', 'analyst', 'manager', 'admin'],
  };
  for (const [perm, allowed] of Object.entries(matrix)) {
    it(`grants ${perm} only to ${allowed.join(', ')}`, () => {
      for (const role of ROLE_KEYS) expect(can({ role }, perm as never)).toBe(allowed.includes(role));
    });
  }
  it('treats anonymous users as having no permissions', () => {
    expect(can(null, 'incident.create')).toBe(false);
  });
});
