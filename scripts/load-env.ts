/**
 * Load environment files for standalone scripts (Next.js does this itself for the app).
 *
 *   --remote   use .env.vercel (Turso URL + production secrets) and
 *              refuse to run if it does not point at a hosted database.
 *
 * The first file loaded wins: process.loadEnvFile never overrides a variable that is already set.
 */
import fs from 'node:fs';
import path from 'node:path';

const remote = process.argv.includes('--remote');
const files = remote ? ['.env.vercel'] : ['.env.local', '.env'];

for (const file of files) {
  const p = path.join(process.cwd(), file);
  if (fs.existsSync(p)) process.loadEnvFile(p);
  else if (remote) {
    console.error(`Missing ${file}. Run "npm run setup:production" and fill in your Turso database URL and token.`);
    process.exit(1);
  }
}

if (remote && !(process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL)) {
  console.error('TURSO_DATABASE_URL is empty in .env.vercel; refusing to run against the local database.');
  process.exit(1);
}
