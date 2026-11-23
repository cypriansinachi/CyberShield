#!/usr/bin/env node
/**
 * Generates environment files with strong random secrets. Idempotent: values
 * that already exist are never overwritten.
 *
 *   npm run setup               → .env.local             (local development; run automatically by `npm run dev`)
 *   npm run setup:production    → .env.vercel            (values to import into Vercel; never commit)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const production = process.argv.includes('--production');
const quiet = process.argv.includes('--quiet');
const file = path.join(process.cwd(), production ? '.env.vercel' : '.env.local');
const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const has = (key) => new RegExp(`^${key}=`, 'm').test(existing);
const hex = () => crypto.randomBytes(32).toString('hex');

const common = [
  ['SESSION_SECRET', hex, 'HMAC key for hashing session tokens'],
  ['DATA_ENCRYPTION_KEY', hex, 'AES-256 key for evidence and MFA secrets (64 hex chars). BACK THIS UP: losing it makes evidence unreadable.'],
  ['AUDIT_HMAC_KEY', hex, 'HMAC key sealing the audit-log hash chain'],
  ['SHOW_DEMO_ACCOUNTS', () => 'true', 'Show demo credentials on the sign-in page (set to false for real use)'],
  ['NEXT_PUBLIC_APP_TIMEZONE', () => 'Africa/Lagos', 'IANA timezone for displaying dates'],
];
const productionOnly = [
  ['TURSO_DATABASE_URL', () => '', 'Turso database URL, e.g. libsql://cybershield-<you>.turso.io (added automatically if you use the Vercel–Turso integration)'],
  ['TURSO_AUTH_TOKEN', () => '', 'Turso database auth token'],
  ['CRON_SECRET', hex, 'Protects /api/cron/sla; Vercel Cron sends it automatically'],
];
const wanted = production ? [...productionOnly, ...common] : common;

const additions = wanted.filter(([key]) => !has(key));
if (additions.length) {
  const block = additions.map(([key, gen, comment]) => `# ${comment}\n${key}=${gen()}`).join('\n');
  const header = existing
    ? '\n'
    : production
      ? '# Production environment for CyberShield on Vercel. Import into Vercel → Settings → Environment Variables.\n# Never commit this file.\n'
      : '# Local environment for CyberShield. Never commit this file.\n';
  fs.writeFileSync(file, `${existing}${header}${block}\n`, { mode: 0o600 });
  console.log(`[setup] Wrote ${additions.map(([k]) => k).join(', ')} to ${path.basename(file)}`);
} else if (!quiet) {
  console.log(`[setup] ${path.basename(file)} already contains all settings.`);
}
