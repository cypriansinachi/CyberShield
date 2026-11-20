/**
 * Demo data: users for every role and ~45 realistic incidents spread over the
 * last 60 days, progressed through the workflow with consistent timestamps.
 *
 *   npm run db:seed            seed an empty database
 *   npm run db:reset           wipe the database, then seed
 *   npm run db:seed:remote     seed the hosted (Turso) database using .env.vercel
 *
 * Works against the local SQLite file or a hosted Turso database (whichever
 * TURSO_DATABASE_URL / DATABASE_URL points at). All data is fictitious
 * (see "Limited access to real cybersecurity data").
 */
import './load-env';
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { config } from '@/server/config';
import { seedDemoData } from '@/server/demo-seed';

const args = new Set(process.argv.slice(2));

const TABLES = ['evidence_blobs', 'attachments', 'incident_tasks', 'incident_events', 'notifications', 'incidents', 'sessions', 'rate_limits', 'audit_logs', 'users'];

/** Wipe the database before seeding (local file deleted; hosted DB tables dropped). */
async function reset() {
  const url = config.database.url;
  if (url.startsWith('file:')) {
    const file = url.slice('file:'.length);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    console.log(`[seed] Removed ${file}`);
    return;
  }
  if (!args.has('--force')) {
    console.error('[seed] Refusing to wipe a hosted database without --force.');
    process.exit(1);
  }
  const client = createClient({ url, authToken: config.database.authToken });
  await client.executeMultiple(TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n'));
  client.close();
  console.log('[seed] Dropped all tables in the hosted database.');
}

async function main() {
  if (config.isProd && !args.has('--force')) {
    console.error('Refusing to seed demo data in production (pass --force to override).');
    process.exit(1);
  }
  console.log(`[seed] Database: ${config.database.url.replace(/\/\/.*@/, '//')}`);
  if (args.has('--reset')) await reset();
  const r = await seedDemoData((m) => console.log(m));
  if (r.skipped) console.log('[seed] Use "npm run db:reset" (or --reset --force for a hosted database) to start fresh.');
}

main()
  .then(() => process.exit(0)) // close the database connection (a WebSocket would keep Node alive)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
