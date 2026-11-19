import crypto from 'node:crypto';
import { runSlaEscalations } from '@/server/services/incidents';

/**
 * Scheduled SLA escalation for serverless hosting (see vercel.json).
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; anything else is refused.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const sent = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const ok = !!secret && sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return new Response('Unauthorized', { status: 401 });
  const escalated = await runSlaEscalations();
  return Response.json({ escalated }, { headers: { 'Cache-Control': 'no-store' } });
}
