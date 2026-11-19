import 'server-only';
/**
 * Fixed-window rate limiter for authentication endpoints, stored in the
 * database so the limit holds across every server instance (essential on
 * serverless hosts, where each request may land on a different instance).
 * Complements per-account lockout: lockout stops guessing one account's
 * password, rate limiting stops one client spraying many accounts.
 */
import { sqlAll, sqlOne } from '../db';

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs) * windowMs; // window start (ms), comparable across limiters
  const row = await sqlOne<{ hits: number }>(
    `INSERT INTO rate_limits (key, bucket, hits) VALUES (?, ?, 1)
     ON CONFLICT (key, bucket) DO UPDATE SET hits = hits + 1
     RETURNING hits`,
    [key, bucket],
  );
  // Occasionally clear out windows older than a day.
  if (Math.random() < 0.02) await sqlAll('DELETE FROM rate_limits WHERE bucket < ?', [now - 86_400_000]);
  return { allowed: Number(row.hits) <= limit, retryAfterMs: bucket + windowMs - now };
}
