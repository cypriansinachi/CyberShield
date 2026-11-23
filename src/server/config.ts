import 'server-only';
import path from 'node:path';

/**
 * Server configuration. Secrets come only from the environment (.env.local in
 * development, real environment variables in production), never from code.
 * Next.js loads .env files itself; standalone scripts load them through
 * scripts/load-env.ts.
 */
const ROOT = process.cwd();

function int(name: string, fallback: number) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}
function bool(name: string, fallback: boolean) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function secret(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required secret ${name}. Run "npm run setup" to generate .env.local.`);
  return v;
}
// Runtime data location (local database file); not a source file to bundle.
const resolvePath = (p: string) => (path.isAbsolute(p) ? p : path.join(/*turbopackIgnore: true*/ ROOT, p));

// Tolerate values pasted with surrounding quotes or whitespace.
const envValue = (name: string) => (process.env[name] || '').trim().replace(/^["']|["']$/g, '');

/**
 * Which database to use (first match wins):
 *  1. DATABASE_URL + DATABASE_AUTH_TOKEN: an explicit choice. On Vercel, point
 *     these at the main Turso database. The Vercel–Turso integration can give
 *     each deployment its own database branch through TURSO_DATABASE_URL; such
 *     a branch starts as a copy of the main database and is left behind at the
 *     next deployment, so data created on the site would not carry over.
 *  2. TURSO_DATABASE_URL + TURSO_AUTH_TOKEN: set automatically by the integration.
 *  3. Local / Docker: a SQLite file, data/cirp.db by default (DATABASE_PATH to move it).
 */
export function databaseSource(): { via: 'DATABASE_URL' | 'TURSO_DATABASE_URL' | 'local file'; url: string; token?: string } {
  const explicit = envValue('DATABASE_URL');
  if (explicit) return { via: 'DATABASE_URL', url: explicit, token: envValue('DATABASE_AUTH_TOKEN') || envValue('TURSO_AUTH_TOKEN') || undefined };
  const turso = envValue('TURSO_DATABASE_URL');
  if (turso) return { via: 'TURSO_DATABASE_URL', url: turso, token: envValue('TURSO_AUTH_TOKEN') || envValue('DATABASE_AUTH_TOKEN') || undefined };
  return { via: 'local file', url: '' };
}

function databaseUrl() {
  const remote = databaseSource().url;
  if (remote) {
    // libsql:// would use a long-lived WebSocket. Serverless functions are frozen
    // between requests, so use stateless HTTPS instead (same database, same API).
    return remote.replace(/^libsql:\/\//, 'https://');
  }
  if (process.env.VERCEL) {
    throw new Error(
      'TURSO_DATABASE_URL is not set for this Vercel deployment. Connect a Turso database (Storage → Turso) or add ' +
        'TURSO_DATABASE_URL and TURSO_AUTH_TOKEN under Settings → Environment Variables, then redeploy.',
    );
  }
  return `file:${resolvePath(process.env.DATABASE_PATH || 'data/cirp.db')}`;
}

let dataKey: Buffer | undefined;

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  database: {
    get url() {
      return databaseUrl();
    },
    get authToken() {
      return databaseSource().token;
    },
  },

  session: {
    cookieName: 'cirp_session',
    idleMinutes: int('SESSION_IDLE_MINUTES', 30),
    absoluteHours: int('SESSION_ABSOLUTE_HOURS', 8),
    mfaPendingMinutes: 5,
    secureCookie: bool('SECURE_COOKIES', process.env.NODE_ENV === 'production'),
  },

  security: {
    maxLoginAttempts: int('MAX_LOGIN_ATTEMPTS', 5),
    lockoutMinutes: int('LOCKOUT_MINUTES', 15),
    requireMfaForPrivileged: bool('REQUIRE_MFA_FOR_PRIVILEGED', false),
    allowSelfRegistration: bool('ALLOW_SELF_REGISTRATION', true),
    allowedEmailDomains: (process.env.ALLOWED_EMAIL_DOMAINS || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    authRateLimitPerWindow: int('AUTH_RATE_LIMIT', 20),
    authRateWindowMinutes: 15,
  },

  compliance: {
    breachNotificationHours: int('BREACH_NOTIFICATION_HOURS', 72),
    regulatorName: process.env.REGULATOR_NAME || 'Nigeria Data Protection Commission (NDPC)',
  },

  /** 32-byte AES-256 key for encrypting evidence files and MFA secrets. */
  get dataKey(): Buffer {
    if (!dataKey) {
      dataKey = Buffer.from(secret('DATA_ENCRYPTION_KEY'), 'hex');
      if (dataKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
    }
    return dataKey;
  },
  /** HMAC key that seals the audit-log hash chain. */
  get auditKey(): string {
    return secret('AUDIT_HMAC_KEY');
  },
  /** HMAC key used to hash session tokens before storage. */
  get sessionKey(): string {
    return secret('SESSION_SECRET');
  },
};
