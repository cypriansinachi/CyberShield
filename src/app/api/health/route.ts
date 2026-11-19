import { sqlOne } from '@/server/db';

/** Liveness/readiness probe for hosting platforms. Reveals no data. */
export async function GET() {
  try {
    await sqlOne('SELECT 1 AS ok');
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'error' }, { status: 503 });
  }
}
