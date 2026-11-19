import 'server-only';
/**
 * Server-side sessions.
 *
 *  - The browser only holds an opaque 256-bit random token in an HttpOnly,
 *    SameSite=Strict cookie (Secure in production). JavaScript cannot read it.
 *  - The database stores HMAC-SHA256(token), so a leaked database cannot be
 *    used to hijack sessions.
 *  - Idle timeout (sliding) plus absolute timeout; both enforced server-side.
 *  - A fresh token is issued at every login and after MFA (prevents session
 *    fixation), and sessions can be revoked centrally (logout everywhere,
 *    password change, account deactivation).
 */
import { cookies } from 'next/headers';
import { and, eq, lt, ne, or } from 'drizzle-orm';
import { getDb } from '../db';
import { sessions, type Session } from '../db/schema';
import { config } from '../config';
import { hmacSha256, randomToken } from '../security/crypto';
import type { RequestMeta } from '../request';

const tokenId = (token: string) => hmacSha256(config.sessionKey, token);

export async function createSession(userId: number, stage: Session['stage'], meta: RequestMeta) {
  const token = randomToken(32);
  const now = Date.now();
  const pending = stage === 'mfa_pending';
  const idleMs = (pending ? config.session.mfaPendingMinutes : config.session.idleMinutes) * 60_000;
  const absoluteMs = pending ? config.session.mfaPendingMinutes * 60_000 : config.session.absoluteHours * 3_600_000;

  await (await getDb())
    .insert(sessions)
    .values({
      id: tokenId(token),
      userId,
      stage,
      ip: meta.ip,
      userAgent: meta.userAgent,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      idleExpiresAt: new Date(now + idleMs).toISOString(),
      absoluteExpiresAt: new Date(now + absoluteMs).toISOString(),
    })
    .run();

  (await cookies()).set(config.session.cookieName, token, {
    httpOnly: true,
    secure: config.session.secureCookie,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(absoluteMs / 1000),
  });
  await purgeExpiredSessions();
}

/** Read and validate the session referenced by the request cookie. */
export async function getSessionFromCookie(): Promise<Session | null> {
  const token = (await cookies()).get(config.session.cookieName)?.value;
  if (!token || token.length > 128) return null;
  const db = await getDb();
  const session = await db.select().from(sessions).where(eq(sessions.id, tokenId(token))).get();
  if (!session) return null;
  const now = Date.now();
  if (now > Date.parse(session.idleExpiresAt) || now > Date.parse(session.absoluteExpiresAt)) {
    await db.delete(sessions).where(eq(sessions.id, session.id)).run();
    return null;
  }
  return session;
}

/** Slide the idle timeout forward (at most once a minute to limit writes). */
export async function touchSession(session: Session) {
  const now = Date.now();
  if (session.stage !== 'active' || now - Date.parse(session.lastSeenAt) < 60_000) return;
  const idleExpires = Math.min(now + config.session.idleMinutes * 60_000, Date.parse(session.absoluteExpiresAt));
  await (await getDb())
    .update(sessions)
    .set({ lastSeenAt: new Date(now).toISOString(), idleExpiresAt: new Date(idleExpires).toISOString() })
    .where(eq(sessions.id, session.id))
    .run();
}

/** End the current session (logout). Only callable from Server Actions / Route Handlers. */
export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(config.session.cookieName)?.value;
  if (token) await (await getDb()).delete(sessions).where(eq(sessions.id, tokenId(token))).run();
  jar.delete(config.session.cookieName);
}

/** Revoke all of a user's sessions, optionally keeping one (the current). Returns count. */
export async function revokeUserSessions(userId: number, exceptSessionId?: string): Promise<number> {
  const where = exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
    : eq(sessions.userId, userId);
  const res = await (await getDb()).delete(sessions).where(where).run();
  return res.rowsAffected;
}

export async function listActiveSessions(userId: number) {
  const now = new Date().toISOString();
  const rows = await (await getDb())
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.stage, 'active')))
    .all();
  return rows
    .filter((s) => s.idleExpiresAt > now && s.absoluteExpiresAt > now)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export async function purgeExpiredSessions() {
  const now = new Date().toISOString();
  await (await getDb())
    .delete(sessions)
    .where(or(lt(sessions.idleExpiresAt, now), lt(sessions.absoluteExpiresAt, now)))
    .run();
}
