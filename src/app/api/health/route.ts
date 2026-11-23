import { sqlOne } from '@/server/db';
import { databaseSource } from '@/server/config';
import { hasCronSecret } from '@/server/security/cron-auth';

/**
 * Readiness probe for hosting platforms.
 *
 * When healthy it reveals nothing but {"status":"ok"}. When something is wrong
 * it lists *which* setting or dependency is missing so a deployment can be
 * fixed quickly. It never returns secret values, connection strings or data.
 *
 * With `Authorization: Bearer <CRON_SECRET>` it also returns diagnostics for
 * the operator: which database this deployment is connected to (by name, never
 * the token), row counts, and which deployment and server instance answered.
 */
const REQUIRED = ['SESSION_SECRET', 'DATA_ENCRYPTION_KEY', 'AUDIT_HMAC_KEY'] as const;

// Identifies this server instance, so diagnostics show whether requests share one.
const INSTANCE = { id: crypto.randomUUID().slice(0, 8), startedAt: new Date().toISOString() };

export async function GET(req: Request) {
  const problems: string[] = [];
  for (const name of REQUIRED) if (!process.env[name]) problems.push(`${name} is not set`);
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (key && !/^[0-9a-fA-F]{64}$/.test(key.trim())) problems.push('DATA_ENCRYPTION_KEY must be 64 hexadecimal characters');
  if (process.env.VERCEL && !process.env.CRON_SECRET) problems.push('CRON_SECRET is not set (scheduled SLA checks will be refused)');

  let users = 0;
  let databaseOk = false;
  try {
    users = Number((await sqlOne<{ n: number }>('SELECT COUNT(*) AS n FROM users')).n);
    databaseOk = true;
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

  const body: Record<string, unknown> = problems.length ? { status: 'error', problems } : { status: 'ok' };
  if (process.env.VERCEL && isDeploymentBranch()) {
    body.warnings = [
      'This deployment uses its own database branch, so data created on the site will not carry over to the next deployment. ' +
        'Set DATABASE_URL and DATABASE_AUTH_TOKEN to the main Turso database (see README, Deployment).',
    ];
  }
  if (hasCronSecret(req)) body.diagnostics = await diagnostics(databaseOk);

  return Response.json(body, {
    status: problems.length ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** The database's name, e.g. "cybershield-acme" from libsql://cybershield-acme.turso.io (never the token). */
function databaseName(url: string) {
  try {
    const u = new URL(url);
    return u.hostname ? u.hostname.split('.')[0] : u.pathname;
  } catch {
    return null;
  }
}

/** Vercel–Turso per-deployment branches are named after the deployment ID (dpl-…). */
function isDeploymentBranch() {
  const src = databaseSource();
  return src.via === 'TURSO_DATABASE_URL' && /^dpl-/.test(databaseName(src.url) ?? '');
}

async function diagnostics(databaseOk: boolean) {
  const src = databaseSource();
  const database = src.url
    ? { via: src.via, scheme: src.url.split(':')[0], name: databaseName(src.url), tokenSet: !!src.token, deploymentBranch: isDeploymentBranch() }
    : { via: src.via, scheme: 'file' };
  const count = async (sql: string) => (databaseOk ? (await sqlOne<Record<string, unknown>>(sql)) : null);
  return {
    database,
    // Names only (never values), to spot variables added under unexpected names.
    databaseEnvNames: Object.keys(process.env).filter((k) => /TURSO|LIBSQL|DATABASE/i.test(k)).sort(),
    data: databaseOk
      ? {
          ...(await count('SELECT COUNT(*) AS users, MIN(created_at) AS firstUserCreated FROM users')),
          ...(await count('SELECT COUNT(*) AS incidents FROM incidents')),
          ...(await count('SELECT COUNT(*) AS auditEntries, MIN(ts) AS firstAuditEntry FROM audit_logs')),
        }
      : null,
    deployment: {
      env: process.env.VERCEL_ENV ?? null,
      url: process.env.VERCEL_URL ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    },
    instance: INSTANCE,
  };
}
