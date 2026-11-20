import crypto from 'node:crypto';
import { seedDemoData } from '@/server/demo-seed';

// Seeding makes several hundred queries; allow time on serverless hosts.
export const maxDuration = 300;

/**
 * Load the demo accounts and sample incidents into the deployment's own
 * database (so the data is sealed with the deployment's own audit and
 * encryption keys).
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/setup/demo-data
 *
 * Guards: requires the CRON_SECRET, only works while SHOW_DEMO_ACCOUNTS=true
 * (demo mode), only ever adds data, and does nothing if the demo
 * administrator already exists.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const sent = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const authorised = !!secret && sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!authorised) return new Response('Unauthorized', { status: 401 });
  if (process.env.SHOW_DEMO_ACCOUNTS !== 'true') {
    return Response.json({ error: 'Demo mode is off (SHOW_DEMO_ACCOUNTS is not "true").' }, { status: 403 });
  }
  const result = await seedDemoData();
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
