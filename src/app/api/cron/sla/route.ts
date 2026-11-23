import { runSlaEscalations } from '@/server/services/incidents';
import { hasCronSecret } from '@/server/security/cron-auth';

/**
 * Scheduled SLA escalation for serverless hosting (see vercel.json).
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; anything else is refused.
 */
export async function GET(req: Request) {
  if (!hasCronSecret(req)) return new Response('Unauthorized', { status: 401 });
  const escalated = await runSlaEscalations();
  return Response.json({ escalated }, { headers: { 'Cache-Control': 'no-store' } });
}
