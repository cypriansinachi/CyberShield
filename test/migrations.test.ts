import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_SQL } from '@/server/db/bootstrap';

describe('schema upgrades', () => {
  it('renames incidents.department to affected_service without losing data', async () => {
    // Build a database the way the previous version of the app did.
    const url = process.env.DATABASE_URL!;
    const old = createClient({ url });
    const v1 = BOOTSTRAP_SQL.replace('affected_service       TEXT,', 'department             TEXT,');
    expect(v1).not.toEqual(BOOTSTRAP_SQL);
    await old.executeMultiple(v1);
    await old.execute(
      `INSERT INTO users (full_name, email, role, password_hash, password_changed_at, created_at, updated_at)
       VALUES ('Old Reporter', 'old@example.com', 'reporter', 'x', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    await old.execute(
      `INSERT INTO incidents (title, category, description, reporter_id, department, detected_at, computed_severity, severity, priority,
                              sla_ack_due_at, sla_resolve_due_at, created_at, updated_at)
       VALUES ('Legacy report', 'phishing', 'Created before the upgrade.', 1, 'Finance', '2026-01-01T00:00:00Z', 'low', 'low', 'P4',
               '2026-01-02T00:00:00Z', '2026-01-15T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    old.close();

    // Opening the database through the app runs the upgrade.
    const { getClient } = await import('@/server/db');
    const db = await getClient();
    const columns = (await db.execute('PRAGMA table_info(incidents)')).rows.map((r) => String(r.name));
    expect(columns).toContain('affected_service');
    expect(columns).not.toContain('department');
    const row = (await db.execute("SELECT affected_service FROM incidents WHERE title = 'Legacy report'")).rows[0];
    expect(row.affected_service).toBe('Finance');
  });
});
