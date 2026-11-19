import { describe, expect, it } from 'vitest';
import { getClient } from '@/server/db';
import { recordAudit, verifyAuditChain } from '@/server/audit';

const actor = { id: 1, email: 'admin@test', role: 'admin' as const };

describe('tamper-evident audit trail', () => {
  it('builds a valid hash chain', async () => {
    for (let i = 0; i < 5; i++) await recordAudit({ actor, ip: '10.0.0.1' }, { action: 'test.event', details: { i } });
    const v = await verifyAuditChain();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(5);
    expect(v.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the chain intact under concurrent writes', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => recordAudit({ actor }, { action: 'test.concurrent', details: { i } })));
    const v = await verifyAuditChain();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(15);
  });

  it('is append-only: the database rejects UPDATE and DELETE', async () => {
    const db = await getClient();
    await expect(db.execute("UPDATE audit_logs SET action = 'x' WHERE id = 1")).rejects.toThrow(/append-only/);
    await expect(db.execute('DELETE FROM audit_logs WHERE id = 1')).rejects.toThrow(/append-only/);
  });

  it('detects a modified entry even if the triggers are bypassed', async () => {
    const db = await getClient();
    await db.execute('DROP TRIGGER audit_logs_no_update');
    await db.execute(`UPDATE audit_logs SET details = '{"i":999}' WHERE id = 3`);
    const v = await verifyAuditChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(3);
    expect(v.reason).toMatch(/modified/);
  });

  it('detects a deleted entry', async () => {
    const db = await getClient();
    await db.execute(`UPDATE audit_logs SET details = '{"i":2}' WHERE id = 3`); // undo previous tamper
    expect((await verifyAuditChain()).ok).toBe(true);
    await db.execute('DROP TRIGGER audit_logs_no_delete');
    await db.execute('DELETE FROM audit_logs WHERE id = 2');
    const v = await verifyAuditChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(3);
  });
});
