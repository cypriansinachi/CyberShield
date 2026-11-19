import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getClient, getDb } from '@/server/db';
import { auditLogs, evidenceBlobs, incidents, incidentTasks, users, type User } from '@/server/db/schema';
import * as svc from '@/server/services/incidents';
import { EvidenceError, prepareEvidence, readEvidence } from '@/server/services/evidence';
import type { Role } from '@/lib/rbac';

const ts = new Date().toISOString();
const people: Record<string, User> = {};
async function makeUser(key: string, role: Role) {
  people[key] = await (await getDb())
    .insert(users)
    .values({ fullName: key, email: `${key}@test.local`, role, passwordHash: 'x', createdAt: ts, updatedAt: ts })
    .returning()
    .get();
}
const ctx = (u: User) => ({ actor: u, ip: '127.0.0.1' });
const db = () => getDb();

const report = {
  title: 'Customer list emailed externally',
  category: 'data_breach' as const,
  description: 'A spreadsheet of 500 customers was sent to the wrong address.',
  detectedAt: ts,
  department: 'Finance',
  affectedAssets: '',
  confidentiality: 2,
  integrity: 0,
  availability: 0,
  dataTypes: ['pii' as const],
  scope: 'hundreds' as const,
  ongoing: 'no' as const,
};

beforeAll(async () => {
  await makeUser('alice', 'reporter');
  await makeUser('bob', 'reporter');
  await makeUser('ana', 'analyst');
  await makeUser('mgr', 'manager');
  await makeUser('aud', 'auditor');
});

describe('incident service', () => {
  let id: number;

  it('creates a classified incident with playbook tasks, breach deadline and audit entry', async () => {
    const created = await svc.createIncident(people.alice, report, [], ctx(people.alice));
    id = created.id;
    const row = (await (await db()).select().from(incidents).where(eq(incidents.id, id)).get())!;
    expect(row.reference).toMatch(/^INC-\d{4}-0001$/);
    expect(row.severity).toBe('critical'); // rule R2: >100 people's personal data
    expect(row.breachNotifiable).toBe(true);
    expect(Date.parse(row.notificationDueAt!) - Date.parse(row.createdAt)).toBe(72 * 3_600_000);
    expect((await (await db()).select().from(incidentTasks).where(eq(incidentTasks.incidentId, id)).all()).length).toBeGreaterThan(4);
    expect(await (await db()).select().from(auditLogs).where(eq(auditLogs.action, 'incident.created')).all()).toHaveLength(1);
  });

  it('prevents a reporter from reading someone else’s incident (IDOR) and logs the attempt', async () => {
    expect(await svc.getIncidentDetail(id, people.bob, ctx(people.bob))).toBeNull();
    const denied = await (await db()).select().from(auditLogs).where(eq(auditLogs.outcome, 'denied')).all();
    expect(denied.some((a) => a.actorId === people.bob.id && a.entityId === String(id))).toBe(true);
    expect(await svc.getIncidentDetail(id, people.alice, ctx(people.alice))).not.toBeNull();
  });

  it('hides internal notes and tasks from the reporter', async () => {
    await svc.addComment(id, 'Internal: suspect insider', 'internal', people.ana, ctx(people.ana));
    await svc.addComment(id, 'We are on it', 'public', people.ana, ctx(people.ana));
    const reporterView = (await svc.getIncidentDetail(id, people.alice, ctx(people.alice)))!;
    expect(reporterView.events.some((e) => e.body?.includes('suspect insider'))).toBe(false);
    expect(reporterView.events.some((e) => e.body === 'We are on it')).toBe(true);
    expect(reporterView.tasks).toHaveLength(0);
    const staffView = (await svc.getIncidentDetail(id, people.aud, ctx(people.aud)))!;
    expect(staffView.events.some((e) => e.body?.includes('suspect insider'))).toBe(true);
  });

  it('does not let auditors or reporters change the incident', async () => {
    expect((await svc.transitionIncident(id, 'triaged', {}, people.aud, ctx(people.aud))).ok).toBe(false);
    expect((await svc.assignIncident(id, people.ana.id, people.alice, ctx(people.alice))).ok).toBe(false);
    expect((await svc.overrideSeverity(id, 'low', 'Not that serious really', people.ana, ctx(people.ana))).ok).toBe(false);
  });

  it('runs the full response workflow with compliance gates', async () => {
    expect((await svc.transitionIncident(id, 'triaged', {}, people.ana, ctx(people.ana))).ok).toBe(true);
    expect((await svc.transitionIncident(id, 'investigating', {}, people.ana, ctx(people.ana))).ok).toBe(false); // no assignee yet
    expect((await svc.assignIncident(id, people.ana.id, people.ana, ctx(people.ana))).ok).toBe(true); // self-assign
    for (const to of ['investigating', 'contained', 'eradicated', 'recovered'] as const) {
      expect(await svc.transitionIncident(id, to, {}, people.ana, ctx(people.ana))).toMatchObject({ ok: true });
    }
    for (const t of await (await db()).select().from(incidentTasks).where(eq(incidentTasks.incidentId, id)).all()) {
      await svc.updateTaskStatus(id, t.id, 'done', people.ana, ctx(people.ana));
    }
    const closure = { resolutionSummary: 'Recipient confirmed deletion in writing.', rootCause: 'Auto-complete picked an external address', lessonsLearned: 'Add a DLP rule' };
    expect((await svc.transitionIncident(id, 'closed', closure, people.mgr, ctx(people.mgr))).ok).toBe(false); // regulator not yet notified
    expect((await svc.recordRegulatorNotification(id, { notifiedAt: new Date().toISOString(), authority: 'NDPC', reference: 'NDPC/1' }, people.ana, ctx(people.ana))).ok).toBe(true);
    expect((await svc.transitionIncident(id, 'closed', closure, people.ana, ctx(people.ana))).ok).toBe(false); // critical → needs manager
    expect((await svc.transitionIncident(id, 'closed', closure, people.mgr, ctx(people.mgr))).ok).toBe(true);
    const row = (await (await db()).select().from(incidents).where(eq(incidents.id, id)).get())!;
    expect(row.status).toBe('closed');
    expect(row.closedAt).not.toBeNull();
    expect(row.acknowledgedAt).not.toBeNull();
  });

  it('records a manager override with justification', async () => {
    const { id: other } = await svc.createIncident(people.bob, { ...report, category: 'phishing', dataTypes: [], confidentiality: 0, scope: 'single' }, [], ctx(people.bob));
    expect((await svc.overrideSeverity(other, 'high', 'CEO was targeted directly', people.mgr, ctx(people.mgr))).ok).toBe(true);
    const row = (await (await db()).select().from(incidents).where(eq(incidents.id, other)).get())!;
    expect(row).toMatchObject({ severity: 'high', computedSeverity: 'low', severityOverridden: true, priority: 'P2' });
  });

  it('escalates an overdue SLA exactly once, even when two sweeps run at the same time', async () => {
    const { id: late } = await svc.createIncident(people.bob, { ...report, category: 'phishing', dataTypes: [], confidentiality: 0, scope: 'single' }, [], ctx(people.bob), {
      createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    const [a, b] = await Promise.all([svc.runSlaEscalations(), svc.runSlaEscalations()]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    const breaches = await (await db()).select().from(auditLogs).where(eq(auditLogs.action, 'incident.sla_breached')).all();
    expect(breaches.filter((x) => x.entityId === String(late))).toHaveLength(1);
  });
});

describe('evidence handling', () => {
  const file = (name: string, content: string) => new File([content], name);

  it('rejects disallowed types, mismatched content and oversized submissions', async () => {
    await expect(prepareEvidence([file('payload.exe', 'MZ')])).rejects.toBeInstanceOf(EvidenceError);
    await expect(prepareEvidence([file('fake.png', 'not really a png')])).rejects.toThrow(/does not match/);
    await expect(prepareEvidence([file('big.txt', 'x'.repeat(5 * 1024 * 1024))])).rejects.toThrow(/at most 4 MB/);
  });

  it('encrypts evidence at rest and detects tampering on download', async () => {
    const { id } = await svc.createIncident(people.alice, report, await prepareEvidence([file('notes.txt', 'attacker ip 203.0.113.9')]), ctx(people.alice));
    const detail = (await svc.getIncidentDetail(id, people.ana, ctx(people.ana)))!;
    const att = detail.attachments[0];
    const blob = (await (await db()).select().from(evidenceBlobs).where(eq(evidenceBlobs.storedName, att.storedName)).get())!;
    expect(Buffer.from(blob.data).includes(Buffer.from('203.0.113.9'))).toBe(false); // ciphertext only
    expect((await readEvidence(att)).toString()).toBe('attacker ip 203.0.113.9');
    expect(await svc.getEvidenceForDownload(id, att.id, people.bob, ctx(people.bob))).toBeNull(); // other reporter

    const tampered = Buffer.from(blob.data);
    tampered[tampered.length - 1] ^= 0xff;
    await (await getClient()).execute({ sql: 'UPDATE evidence_blobs SET data = ? WHERE stored_name = ?', args: [tampered, att.storedName] });
    await expect(svc.getEvidenceForDownload(id, att.id, people.ana, ctx(people.ana))).rejects.toThrow();
    expect(await (await db()).select().from(auditLogs).where(eq(auditLogs.action, 'evidence.integrity_failed')).all()).toHaveLength(1);
  });
});
