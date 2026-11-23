import { describe, expect, it } from 'vitest';
import { adminCreateUser, adminUpdateUser } from '@/server/services/users';
import { findUserById } from '@/server/services/auth';
import { sqlAll, sqlOne } from '@/server/db';
import { can } from '@/lib/rbac';

// Who performs the admin actions (the audit log records it).
const admin = { id: 999, email: 'admin@nexora.local', role: 'admin' as const };
const ctx = { actor: admin, ip: '10.0.0.1' };

async function newUser(email: string) {
  const r = await adminCreateUser({ fullName: 'Test Person', email }, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.user;
}

async function addSession(userId: number) {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 3_600_000).toISOString();
  await sqlAll(
    `INSERT INTO sessions (id, user_id, stage, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
     VALUES (?, ?, 'active', ?, ?, ?, ?)`,
    [`s-${userId}-${Math.random()}`, userId, now, now, later, later],
  );
}
const sessionCount = async (userId: number) => Number((await sqlOne<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE user_id = ?', [userId])).n);

describe('roles are given by an administrator', () => {
  it('creates every new account as a Customer with no department', async () => {
    // Extra fields (as a tampered form might send) are ignored by the service.
    const r = await adminCreateUser({ fullName: 'Sneaky', email: 'sneaky@example.com', role: 'admin', department: 'Finance' } as never, ctx);
    if (!r.ok) throw new Error(r.error);
    const stored = (await findUserById(r.user.id))!;
    expect(stored.role).toBe('reporter');
    expect(stored.department).toBeNull();
    expect(stored.mustChangePassword).toBe(true);
    expect(can(stored, 'incident.view_all')).toBe(false);
  });

  it('lets an admin promote a customer to analyst, signing them out and auditing it', async () => {
    const user = await newUser('promote.me@example.com');
    await addSession(user.id);
    expect(await sessionCount(user.id)).toBe(1);

    const r = await adminUpdateUser(user.id, { role: 'analyst', department: 'Security Operations', isActive: true }, ctx);
    expect(r.ok).toBe(true);

    const stored = (await findUserById(user.id))!;
    expect(stored.role).toBe('analyst');
    expect(can(stored, 'incident.view_all')).toBe(true);
    expect(await sessionCount(user.id)).toBe(0);

    const audit = await sqlOne<{ details: string; actor_id: number }>(
      "SELECT details, actor_id FROM audit_logs WHERE action = 'user.role_changed' AND entity_id = ? ORDER BY id DESC LIMIT 1",
      [String(user.id)], // entity_id is a TEXT column
    );
    expect(audit.actor_id).toBe(admin.id);
    expect(JSON.parse(audit.details).changes.role).toEqual({ from: 'reporter', to: 'analyst' });
  });

  it('removes access when the role is set back to Customer', async () => {
    const user = await newUser('demote.me@example.com');
    await adminUpdateUser(user.id, { role: 'manager', department: 'Security Operations', isActive: true }, ctx);
    await addSession(user.id);

    await adminUpdateUser(user.id, { role: 'reporter', department: null, isActive: true }, ctx);
    const stored = (await findUserById(user.id))!;
    expect(stored.role).toBe('reporter');
    expect(can(stored, 'incident.view_all')).toBe(false);
    expect(can(stored, 'incident.assign')).toBe(false);
    expect(await sessionCount(user.id)).toBe(0);
  });

  it('does not let an admin change their own role', async () => {
    const self = await newUser('self.admin@nexora.local');
    await adminUpdateUser(self.id, { role: 'admin', department: 'Information Technology', isActive: true }, ctx);
    const r = await adminUpdateUser(self.id, { role: 'reporter', department: null, isActive: true }, { actor: { id: self.id, email: self.email, role: 'admin' as const } });
    expect(r).toEqual({ ok: false, error: 'You cannot change your own role or deactivate your own account.' });
    expect((await findUserById(self.id))!.role).toBe('admin');
  });
});
