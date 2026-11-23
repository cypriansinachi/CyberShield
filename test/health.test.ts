import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

process.env.CRON_SECRET = 'health-test-secret';
process.env.TURSO_AUTH_TOKEN = 'super-secret-token-value';

const call = (auth?: string) => GET(new Request('http://localhost/api/health', { headers: auth ? { authorization: auth } : {} }));

describe('health endpoint', () => {
  it('reveals no diagnostics without the secret', async () => {
    const body = await (await call()).json();
    expect(body.diagnostics).toBeUndefined();
    expect((await (await call('Bearer wrong')).json()).diagnostics).toBeUndefined();
  });

  it('shows which database is in use to the operator, without secrets', async () => {
    const res = await call('Bearer health-test-secret');
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.diagnostics.database).toMatchObject({ via: 'DATABASE_URL', scheme: 'file', tokenSet: true });
    expect(body.diagnostics.data).toMatchObject({ users: 0, incidents: 0 });
    expect(body.diagnostics.instance.id).toMatch(/^[0-9a-f]{8}$/);
    expect(text).not.toContain('super-secret-token-value');
    expect(text).not.toContain('health-test-secret');
  });
});
