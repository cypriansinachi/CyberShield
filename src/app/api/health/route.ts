import { sqlOne } from '@/server/db';

/**
 * Readiness probe for hosting platforms.
 *
 * When healthy it reveals nothing but {"status":"ok"}. When something is wrong
 * it lists *which* setting or dependency is missing so a deployment can be
 * fixed quickly. It never returns secret values, connection strings or data.
 */
const REQUIRED = ['SESSION_SECRET', 'DATA_ENCRYPTION_KEY', 'AUDIT_HMAC_KEY'] as const;

export async function GET() {
  const problems: string[] = [];
  for (const name of REQUIRED) if (!process.env[name]) problems.push(`${name} is not set`);
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (key && !/^[0-9a-fA-F]{64}$/.test(key.trim())) problems.push('DATA_ENCRYPTION_KEY must be 64 hexadecimal characters');
  if (process.env.VERCEL && !process.env.CRON_SECRET) problems.push('CRON_SECRET is not set (scheduled SLA checks will be refused)');

  let users = 0;
  try {
    users = Number((await sqlOne<{ n: number }>('SELECT COUNT(*) AS n FROM users')).n);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    problems.push(
      /TURSO_DATABASE_URL is not set/.test(msg)
        ? 'TURSO_DATABASE_URL is not set: connect a Turso database and redeploy'
        : /401|unauthori[sz]ed|auth/i.test(msg)
          ? 'database rejected the credentials: check TURSO_AUTH_TOKEN'
          : 'database unreachable: check TURSO_DATABASE_URL',
    );
  }
  if (!problems.length && users === 0) problems.push('database has no user accounts yet: run "npm run db:seed:remote" or register the first account');

  return Response.json(problems.length ? { status: 'error', problems } : { status: 'ok' }, {
    status: problems.length ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
