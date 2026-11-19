import 'server-only';
/**
 * Tamper-evident audit trail.
 *
 * Every security-relevant action is appended to `audit_logs`. Each entry stores
 *
 *     hash = HMAC-SHA256(AUDIT_HMAC_KEY, prev_hash + "\n" + canonical(entry))
 *
 * so modifying, inserting or deleting any historical row breaks the chain from
 * that point on. Database triggers also reject UPDATE and DELETE on the table,
 * and because the chain is keyed, someone with raw database access cannot
 * forge a valid replacement chain without also stealing the application secret.
 *
 * Appends run inside a write transaction (BEGIN IMMEDIATE), so concurrent
 * requests, even from different serverless instances, are serialised and the
 * chain never forks.
 */
import { desc } from 'drizzle-orm';
import { getDb, sqlAll } from './db';
import { auditLogs, type AuditOutcome } from './db/schema';
import { config } from './config';
import { hmacSha256 } from './security/crypto';
import type { Role } from '@/lib/rbac';

export const GENESIS_HASH = '0'.repeat(64);

export type Actor = { id: number; email: string; role: Role; fullName?: string };
export type AuditContext = {
  actor?: Actor | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

type Entry = {
  ts: string;
  actor_id: number | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  details: string;
};

function canonical(e: Entry) {
  return JSON.stringify([
    e.ts, e.actor_id, e.actor_email, e.actor_role, e.action, e.entity_type, e.entity_id,
    e.outcome, e.ip, e.user_agent, e.request_id, e.details,
  ]);
}

const computeHash = (prev: string, e: Entry) => hmacSha256(config.auditKey, `${prev}\n${canonical(e)}`);

export async function recordAudit(
  ctx: AuditContext,
  event: {
    action: string;
    entityType?: string | null;
    entityId?: string | number | null;
    outcome?: AuditOutcome;
    details?: Record<string, unknown>;
  },
): Promise<{ id: number; hash: string }> {
  const entry: Entry = {
    ts: new Date().toISOString(),
    actor_id: ctx.actor?.id ?? null,
    actor_email: ctx.actor?.email ?? null,
    actor_role: ctx.actor?.role ?? null,
    action: event.action,
    entity_type: event.entityType ?? null,
    entity_id: event.entityId === null || event.entityId === undefined ? null : String(event.entityId),
    outcome: event.outcome ?? 'success',
    ip: ctx.ip ?? null,
    user_agent: ctx.userAgent?.slice(0, 255) ?? null,
    request_id: ctx.requestId ?? null,
    details: JSON.stringify(event.details ?? {}),
  };
  const db = await getDb();
  return db.transaction(async (tx) => {
    const last = await tx.select({ hash: auditLogs.hash }).from(auditLogs).orderBy(desc(auditLogs.id)).limit(1).get();
    const prev = last?.hash ?? GENESIS_HASH;
    const hash = computeHash(prev, entry);
    const row = await tx
      .insert(auditLogs)
      .values({
        ts: entry.ts,
        actorId: entry.actor_id,
        actorEmail: entry.actor_email,
        actorRole: entry.actor_role,
        action: entry.action,
        entityType: entry.entity_type,
        entityId: entry.entity_id,
        outcome: entry.outcome,
        ip: entry.ip,
        userAgent: entry.user_agent,
        requestId: entry.request_id,
        details: entry.details,
        prevHash: prev,
        hash,
      })
      .returning({ id: auditLogs.id })
      .get();
    return { id: row.id, hash };
  });
}

export type ChainVerification = {
  ok: boolean;
  checked: number;
  headHash: string | null;
  brokenAt: number | null;
  reason: string | null;
  verifiedAt: string;
};

/** Recompute the whole chain (in pages of 1,000 entries) and report the first broken link. */
export async function verifyAuditChain(): Promise<ChainVerification> {
  let prev = GENESIS_HASH;
  let expectedId: number | null = null;
  let checked = 0;
  let afterId = 0;
  const verifiedAt = new Date().toISOString();
  const fail = (brokenAt: number, reason: string): ChainVerification => ({ ok: false, checked, headHash: null, brokenAt, reason, verifiedAt });

  for (;;) {
    const rows = await sqlAll<Entry & { id: number; prev_hash: string; hash: string }>(
      'SELECT * FROM audit_logs WHERE id > ? ORDER BY id ASC LIMIT 1000',
      [afterId],
    );
    if (!rows.length) break;
    for (const row of rows) {
      if (expectedId !== null && row.id !== expectedId) {
        return fail(row.id, `Entries #${expectedId}–#${row.id - 1} are missing (deleted).`);
      }
      if (row.prev_hash !== prev) return fail(row.id, 'Link to the previous entry does not match (an entry was removed or re-ordered).');
      if (computeHash(prev, row) !== row.hash) return fail(row.id, 'Entry content does not match its hash (the entry was modified).');
      prev = row.hash;
      expectedId = row.id + 1;
      afterId = row.id;
      checked++;
    }
  }
  return { ok: true, checked, headHash: checked ? prev : null, brokenAt: null, reason: null, verifiedAt };
}
