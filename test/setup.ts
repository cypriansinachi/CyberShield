import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Each test file gets its own throwaway SQLite file. (libSQL pools connections,
// and every new in-memory connection would be a separate, empty database.)
process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `cirp-test-${crypto.randomUUID()}.db`)}`;
