import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/setup/demo-data/route';
import { sqlOne } from '@/server/db';
import { verifyAuditChain } from '@/server/audit';

process.env.CRON_SECRET = 'test-cron-secret';
process.env.SHOW_DEMO_ACCOUNTS = 'true';

const call = (query = '', auth = 'Bearer test-cron-secret') =>
  POST(new Request(`http://localhost/api/setup/demo-data${query}`, { method: 'POST', headers: { authorization: auth } }));
const count = async (table: string) => Number((await sqlOne<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)).n);

describe('demo data setup endpoint', () => {
  it('rejects requests without the secret', async () => {
    expect((await call('', '')).status).toBe(401);
    expect((await call('', 'Bearer wrong-secret-of-same-len')).status).toBe(401);
  });

  it('seeds once, then leaves existing data alone', async () => {
    const first = await (await call()).json();
    expect(first).toMatchObject({ reset: false, skipped: false, users: 17 });
    expect(await count('incidents')).toBe(first.incidents);
    const second = await (await call()).json();
    expect(second).toMatchObject({ reset: false, skipped: true, users: 0 });
  }, 60_000);

  it('adds demo accounts that are missing without touching incidents', async () => {
    const incidentsBefore = await count('incidents');
    await sqlOne("DELETE FROM users WHERE email = 'femi.johnson@nexora.local' RETURNING id");
    const r = await (await call()).json();
    expect(r).toMatchObject({ skipped: true, users: 1, incidents: 0 });
    expect(await count('incidents')).toBe(incidentsBefore);
    const back = await sqlOne<{ role: string }>("SELECT role FROM users WHERE email = 'femi.johnson@nexora.local'");
    expect(back.role).toBe('auditor');
  }, 60_000);

  it('?reset=all-data wipes everything and rebuilds the demo', async () => {
    const extra = await sqlOne<{ id: number }>(
      `INSERT INTO users (full_name, email, role, password_hash, password_changed_at, created_at, updated_at)
       VALUES ('Someone Else', 'someone@example.com', 'reporter', 'x', '2026-01-01', '2026-01-01', '2026-01-01') RETURNING id`,
    );
    expect(extra.id).toBeGreaterThan(17);
    const r = await (await call('?reset=all-data')).json();
    expect(r).toMatchObject({ reset: true, skipped: false, users: 17 });
    expect(await count('users')).toBe(17);
    expect(await count('incidents')).toBe(r.incidents);
    const admin = await sqlOne<{ role: string; department: string }>("SELECT role, department FROM users WHERE email = 'admin@nexora.local'");
    expect(admin).toMatchObject({ role: 'admin' });
    const customer = await sqlOne<{ role: string; department: string | null }>("SELECT role, department FROM users WHERE email = 'customer@example.com'");
    expect(customer).toMatchObject({ role: 'reporter', department: null });
    expect((await verifyAuditChain()).ok).toBe(true);
  }, 60_000);

  it('refuses to run outside demo mode', async () => {
    process.env.SHOW_DEMO_ACCOUNTS = 'false';
    expect((await call('?reset=all-data')).status).toBe(403);
    process.env.SHOW_DEMO_ACCOUNTS = 'true';
  });
});
