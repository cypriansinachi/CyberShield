import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client, type Transaction } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { config } from '../config';
import * as schema from './schema';
import { ALL_TABLES, BOOTSTRAP_SQL } from './bootstrap';

/**
 * Database connection (libSQL).
 *
 * The same code talks to a local SQLite file (development, Docker, tests) or to
 * Turso, hosted SQLite, in serverless deployments such as Vercel, where the
 * filesystem is read-only and short-lived. The schema is created idempotently
 * on first use, so a brand-new Turso database needs no manual migration.
 */
export type DB = LibSQLDatabase<typeof schema>;
type Handles = { client: Client; db: DB; ready: Promise<void> };

// Survive hot reloads in development and warm serverless invocations.
const globalForDb = globalThis as unknown as { __cirpDb?: Handles };

/**
 * The local SQLite driver is synchronous: if one request holds a write
 * transaction across an `await` while another request writes, the second
 * blocks the whole thread waiting for a lock the first can never release.
 * Locally (development, Docker, tests) we therefore serialise database work
 * through an in-process async lock: a transaction holds it from BEGIN until
 * COMMIT/ROLLBACK, and other queries queue behind it instead of blocking.
 * Turso needs none of this: its server queues concurrent writes.
 */
function serialised(client: Client): Client {
  let tail: Promise<void> = Promise.resolve();
  const acquire = (): Promise<() => void> => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const ready = tail.then(() => release);
    tail = tail.then(() => held);
    return ready;
  };
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    const release = await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const wrapTransaction = (tx: Transaction, release: () => void): Transaction => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        release();
      }
    };
    return new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        if (prop === 'commit' || prop === 'rollback') {
          return async (...args: unknown[]) => {
            try {
              return await value.apply(target, args);
            } finally {
              finish();
            }
          };
        }
        if (prop === 'close') {
          return (...args: unknown[]) => {
            try {
              return value.apply(target, args);
            } finally {
              finish();
            }
          };
        }
        return value.bind(target);
      },
    });
  };
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop === 'execute' || prop === 'batch' || prop === 'executeMultiple' || prop === 'migrate') {
        return (...args: unknown[]) => run(() => value.apply(target, args));
      }
      if (prop === 'transaction') {
        return async (...args: unknown[]) => {
          const release = await acquire();
          try {
            return wrapTransaction(await value.apply(target, args), release);
          } catch (err) {
            release();
            throw err;
          }
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * In-place upgrades for databases created by an earlier version of the schema.
 * Each step checks before it changes anything, so it is safe to run on every start.
 */
async function migrate(client: Client) {
  const columns = (await client.execute('PRAGMA table_info(incidents)')).rows.map((r) => String(r.name));
  // v2: incidents record the affected CyberShield service rather than a staff department.
  if (columns.includes('department') && !columns.includes('affected_service')) {
    await client.execute('ALTER TABLE incidents RENAME COLUMN department TO affected_service');
  }
}

function open(): Handles {
  const url = config.database.url;
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true });
  const raw = createClient({
    url,
    authToken: config.database.authToken,
    // Local files: wait for another *process* (e.g. the seed script) holding the lock.
    timeout: 10_000,
  });
  const client = url.startsWith('file:') ? serialised(raw) : raw;
  const db = drizzle(client, { schema });
  const ready = (async () => {
    if (url.startsWith('file:')) await client.execute('PRAGMA journal_mode = WAL');
    await client.executeMultiple(BOOTSTRAP_SQL);
    await migrate(client);
  })();
  // A failed start (e.g. network) must not poison every later request.
  ready.catch(() => {
    if (globalForDb.__cirpDb?.client === client) globalForDb.__cirpDb = undefined;
  });
  return { client, db, ready };
}

/** Opened lazily so that `next build` never touches the database. */
function handles(): Handles {
  globalForDb.__cirpDb ??= open();
  return globalForDb.__cirpDb;
}

export async function getDb(): Promise<DB> {
  const h = handles();
  await h.ready;
  return h.db;
}

/** Raw libSQL client, for aggregate SQL that reads more clearly than a query builder. */
export async function getClient(): Promise<Client> {
  const h = handles();
  await h.ready;
  return h.client;
}

/** Run a raw SQL query and return typed rows. */
export async function sqlAll<T>(sql: string, args: (string | number | null)[] = []): Promise<T[]> {
  const rs = await (await getClient()).execute({ sql, args });
  return rs.rows as unknown as T[];
}

export async function sqlOne<T>(sql: string, args: (string | number | null)[] = []): Promise<T> {
  return (await sqlAll<T>(sql, args))[0];
}

/**
 * Drop every table and recreate the empty schema. This destroys all data,
 * including the audit trail, so it is only used to reset a demo deployment.
 */
export async function resetDatabase(): Promise<void> {
  const client = await getClient();
  await client.executeMultiple(ALL_TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n'));
  await client.executeMultiple(BOOTSTRAP_SQL);
}

export { schema };
