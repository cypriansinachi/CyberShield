import 'server-only';
import crypto from 'node:crypto';

/**
 * True when the request carries `Authorization: Bearer <CRON_SECRET>`.
 * Used by Vercel Cron and by the operator-only maintenance endpoints.
 * Compared in constant time; always false when CRON_SECRET is not set.
 */
export function hasCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const sent = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return sent.length === expected.length && crypto.timingSafeEqual(sent, expected);
}
