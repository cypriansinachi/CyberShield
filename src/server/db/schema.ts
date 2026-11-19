/**
 * Drizzle ORM table definitions (type-safe query layer).
 * The physical schema, including CHECK constraints and the append-only audit
 * triggers, is created by ./bootstrap.ts. Keep the two in sync.
 */
import { blob, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { DataType, Severity, Category, Scope, Ongoing, RiskFactor, RiskRule } from '@/lib/risk';
import type { Status } from '@/lib/workflow';
import type { Role } from '@/lib/rbac';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  department: text('department'),
  role: text('role').$type<Role>().notNull().default('reporter'),
  passwordHash: text('password_hash').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: text('locked_until'),
  mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
  mfaSecretEnc: text('mfa_secret_enc'),
  mfaLastCounter: integer('mfa_last_counter'),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  lastLoginAt: text('last_login_at'),
  passwordChangedAt: text('password_changed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // HMAC-SHA256 of the cookie token, never the token itself
  userId: integer('user_id').notNull(),
  stage: text('stage').$type<'mfa_pending' | 'active'>().notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  idleExpiresAt: text('idle_expires_at').notNull(),
  absoluteExpiresAt: text('absolute_expires_at').notNull(),
});

export type RiskFactorsJson = { factors: RiskFactor[]; rules: RiskRule[]; scoreSeverity: Severity };

export const incidents = sqliteTable('incidents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reference: text('reference'),
  title: text('title').notNull(),
  category: text('category').$type<Category>().notNull(),
  description: text('description').notNull(),
  status: text('status').$type<Status>().notNull().default('new'),
  reporterId: integer('reporter_id').notNull(),
  assigneeId: integer('assignee_id'),
  department: text('department'),
  affectedAssets: text('affected_assets'),
  detectedAt: text('detected_at').notNull(),

  impactConfidentiality: integer('impact_confidentiality').notNull().default(0),
  impactIntegrity: integer('impact_integrity').notNull().default(0),
  impactAvailability: integer('impact_availability').notNull().default(0),
  dataTypes: text('data_types', { mode: 'json' }).$type<DataType[]>().notNull().default([]),
  affectedScope: text('affected_scope').$type<Scope>().notNull().default('unknown'),
  ongoing: text('ongoing').$type<Ongoing>().notNull().default('unknown'),

  riskScore: integer('risk_score').notNull().default(0),
  computedSeverity: text('computed_severity').$type<Severity>().notNull(),
  severity: text('severity').$type<Severity>().notNull(),
  priority: text('priority').notNull(),
  riskFactors: text('risk_factors', { mode: 'json' }).$type<RiskFactorsJson>().notNull(),
  severityOverridden: integer('severity_overridden', { mode: 'boolean' }).notNull().default(false),
  overrideReason: text('override_reason'),

  slaAckDueAt: text('sla_ack_due_at').notNull(),
  slaResolveDueAt: text('sla_resolve_due_at').notNull(),
  slaBreachFlags: integer('sla_breach_flags').notNull().default(0), // bit 1 = ack escalated, bit 2 = resolve escalated
  acknowledgedAt: text('acknowledged_at'),
  containedAt: text('contained_at'),
  recoveredAt: text('recovered_at'),
  closedAt: text('closed_at'),

  resolutionSummary: text('resolution_summary'),
  rootCause: text('root_cause'),
  lessonsLearned: text('lessons_learned'),

  breachNotifiable: integer('breach_notifiable', { mode: 'boolean' }).notNull().default(false),
  notificationDueAt: text('notification_due_at'),
  notifiedAt: text('notified_at'),
  notificationRef: text('notification_ref'),
  notificationAuthority: text('notification_authority'),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type EventType =
  | 'created'
  | 'comment'
  | 'status_change'
  | 'assignment'
  | 'classification'
  | 'task'
  | 'attachment'
  | 'compliance'
  | 'sla';

export const incidentEvents = sqliteTable('incident_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: integer('incident_id').notNull(),
  actorId: integer('actor_id'),
  type: text('type').$type<EventType>().notNull(),
  visibility: text('visibility').$type<'internal' | 'public'>().notNull().default('internal'),
  body: text('body'),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text('created_at').notNull(),
});

export type TaskStatus = 'open' | 'done' | 'not_applicable';

export const incidentTasks = sqliteTable('incident_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: integer('incident_id').notNull(),
  phase: text('phase').notNull(),
  title: text('title').notNull(),
  status: text('status').$type<TaskStatus>().notNull().default('open'),
  sortOrder: integer('sort_order').notNull().default(0),
  completedBy: integer('completed_by'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
});

export const attachments = sqliteTable('attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  incidentId: integer('incident_id').notNull(),
  uploadedBy: integer('uploaded_by').notNull(),
  originalName: text('original_name').notNull(),
  storedName: text('stored_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evidenceBlobs = sqliteTable('evidence_blobs', {
  storedName: text('stored_name').primaryKey(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    bucket: integer('bucket').notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.bucket] })],
);

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  incidentId: integer('incident_id'),
  message: text('message').notNull(),
  link: text('link'),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export type AuditOutcome = 'success' | 'failure' | 'denied';

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: text('ts').notNull(),
  actorId: integer('actor_id'),
  actorEmail: text('actor_email'),
  actorRole: text('actor_role'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  outcome: text('outcome').$type<AuditOutcome>().notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  details: text('details').notNull(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type IncidentEvent = typeof incidentEvents.$inferSelect;
export type IncidentTask = typeof incidentTasks.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
