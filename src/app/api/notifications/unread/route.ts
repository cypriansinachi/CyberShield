import { after } from 'next/server';
import { getCurrentUser } from '@/server/auth/dal';
import { unreadCount } from '@/server/services/notifications';
import { maybeRunSlaEscalations } from '@/server/services/incidents';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  // Every signed-in browser polls this once a minute, which doubles as an SLA
  // sweep on serverless hosts. It runs after the response, so it adds no latency.
  after(() => maybeRunSlaEscalations().catch((err) => console.error('[sla] sweep failed', err)));
  return Response.json({ count: await unreadCount(user.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
