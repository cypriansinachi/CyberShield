import 'server-only';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { notifications, users } from '../db/schema';
import type { Role } from '@/lib/rbac';

type Payload = { message: string; incidentId?: number | null; link?: string | null; excludeUserId?: number | null };

export async function notifyUsers(userIds: (number | null | undefined)[], p: Payload) {
  const ids = [...new Set(userIds.filter((id): id is number => !!id && id !== p.excludeUserId))];
  if (!ids.length) return 0;
  const createdAt = new Date().toISOString();
  await (await getDb())
    .insert(notifications)
    .values(ids.map((userId) => ({ userId, incidentId: p.incidentId ?? null, message: p.message.slice(0, 300), link: p.link ?? null, createdAt })))
    .run();
  return ids.length;
}

export async function notifyRoles(roles: Role[], p: Payload) {
  const rows = await (await getDb())
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, roles)))
    .all();
  return notifyUsers(
    rows.map((r) => r.id),
    p,
  );
}

export async function unreadCount(userId: number) {
  const row = await (await getDb())
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .get();
  return row?.n ?? 0;
}

export async function listNotifications(userId: number, limit = 50) {
  return (await getDb())
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.id))
    .limit(limit)
    .all();
}

export async function markAllRead(userId: number) {
  await (await getDb()).update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId)).run();
}

/** Marks a notification read (only if owned by the user) and returns its link. */
export async function openNotification(id: number, userId: number): Promise<string | null> {
  const db = await getDb();
  const n = await db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).get();
  if (!n) return null;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id)).run();
  return n.link;
}
