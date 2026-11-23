import { resetDatabase } from '@/server/db';
import { hasCronSecret } from '@/server/security/cron-auth';
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
 * Add `?reset=all-data` to wipe the database first (every account, incident
 * and audit entry) and rebuild the demo from scratch.
 *
 * Guards: requires the CRON_SECRET and only works while SHOW_DEMO_ACCOUNTS=true
 * (demo mode). Without the reset parameter it only ever adds data, and does
 * nothing if the demo administrator already exists.
 */
export async function POST(req: Request) {
  if (!hasCronSecret(req)) return new Response('Unauthorized', { status: 401 });
  if (process.env.SHOW_DEMO_ACCOUNTS !== 'true') {
    return Response.json({ error: 'Demo mode is off (SHOW_DEMO_ACCOUNTS is not "true").' }, { status: 403 });
  }
  const reset = new URL(req.url).searchParams.get('reset') === 'all-data';
  if (reset) await resetDatabase();
  const result = await seedDemoData();
  return Response.json({ reset, ...result }, { headers: { 'Cache-Control': 'no-store' } });
}
