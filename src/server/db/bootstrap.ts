/**
 * Physical database schema (SQLite / libSQL). Every statement is idempotent
 * (IF NOT EXISTS), so it is safe to run on each cold start, locally or on Turso.
 * All timestamps are ISO-8601 UTC strings.
 */

/** Every table, children before parents (the order in which they can be dropped). */
export const ALL_TABLES = [
  'evidence_blobs', 'attachments', 'incident_tasks', 'incident_events', 'notifications',
  'incidents', 'sessions', 'rate_limits', 'audit_logs', 'users',
] as const;

export const BOOTSTRAP_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name            TEXT    NOT NULL,
  email                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  department           TEXT,
  role                 TEXT    NOT NULL DEFAULT 'reporter'
                         CHECK (role IN ('reporter', 'analyst', 'manager', 'admin', 'auditor')),
  password_hash        TEXT    NOT NULL,
  is_active            INTEGER NOT NULL DEFAULT 1,
  failed_login_count   INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  mfa_enabled          INTEGER NOT NULL DEFAULT 0,
  mfa_secret_enc       TEXT,
  mfa_last_counter     INTEGER,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at        TEXT,
  password_changed_at  TEXT,
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT    PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage               TEXT    NOT NULL CHECK (stage IN ('mfa_pending', 'active')),
  ip                  TEXT,
  user_agent          TEXT,
  created_at          TEXT    NOT NULL,
  last_seen_at        TEXT    NOT NULL,
  idle_expires_at     TEXT    NOT NULL,
  absolute_expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS incidents (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  reference              TEXT UNIQUE,
  title                  TEXT    NOT NULL,
  category               TEXT    NOT NULL,
  description            TEXT    NOT NULL,
  status                 TEXT    NOT NULL DEFAULT 'new'
                           CHECK (status IN ('new', 'triaged', 'investigating', 'contained',
                                             'eradicated', 'recovered', 'closed', 'rejected')),
  reporter_id            INTEGER NOT NULL REFERENCES users(id),
  assignee_id            INTEGER REFERENCES users(id),
  affected_service       TEXT,
  affected_assets        TEXT,
  detected_at            TEXT    NOT NULL,

  impact_confidentiality INTEGER NOT NULL DEFAULT 0 CHECK (impact_confidentiality BETWEEN 0 AND 3),
  impact_integrity       INTEGER NOT NULL DEFAULT 0 CHECK (impact_integrity BETWEEN 0 AND 3),
  impact_availability    INTEGER NOT NULL DEFAULT 0 CHECK (impact_availability BETWEEN 0 AND 3),
  data_types             TEXT    NOT NULL DEFAULT '[]',
  affected_scope         TEXT    NOT NULL DEFAULT 'unknown',
  ongoing                TEXT    NOT NULL DEFAULT 'unknown',

  risk_score             INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  computed_severity      TEXT    NOT NULL CHECK (computed_severity IN ('low', 'medium', 'high', 'critical')),
  severity               TEXT    NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  priority               TEXT    NOT NULL,
  risk_factors           TEXT    NOT NULL DEFAULT '{}',
  severity_overridden    INTEGER NOT NULL DEFAULT 0,
  override_reason        TEXT,

  sla_ack_due_at         TEXT    NOT NULL,
  sla_resolve_due_at     TEXT    NOT NULL,
  sla_breach_flags       INTEGER NOT NULL DEFAULT 0,
  acknowledged_at        TEXT,
  contained_at           TEXT,
  recovered_at           TEXT,
  closed_at              TEXT,

  resolution_summary     TEXT,
  root_cause             TEXT,
  lessons_learned        TEXT,

  breach_notifiable      INTEGER NOT NULL DEFAULT 0,
  notification_due_at    TEXT,
  notified_at            TEXT,
  notification_ref       TEXT,
  notification_authority TEXT,

  created_at             TEXT    NOT NULL,
  updated_at             TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents(reporter_id);
CREATE INDEX IF NOT EXISTS idx_incidents_assignee ON incidents(assignee_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created  ON incidents(created_at);

CREATE TABLE IF NOT EXISTS incident_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id),
  type        TEXT    NOT NULL,
  visibility  TEXT    NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'public')),
  body        TEXT,
  meta        TEXT    NOT NULL DEFAULT '{}',
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_incident ON incident_events(incident_id, created_at);

CREATE TABLE IF NOT EXISTS incident_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id  INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  phase        TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'not_applicable')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  completed_by INTEGER REFERENCES users(id),
  completed_at TEXT,
  created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_incident ON incident_tasks(incident_id);

CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id   INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL UNIQUE,
  mime_type     TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_incident ON attachments(incident_id);

-- Encrypted evidence content (AES-256-GCM ciphertext). Kept in the database so
-- the platform also runs on serverless hosts with no persistent filesystem.
CREATE TABLE IF NOT EXISTS evidence_blobs (
  stored_name TEXT PRIMARY KEY,
  data        BLOB NOT NULL,
  created_at  TEXT NOT NULL
);

-- Fixed-window rate-limit counters, shared by every server instance.
CREATE TABLE IF NOT EXISTS rate_limits (
  key    TEXT    NOT NULL,
  bucket INTEGER NOT NULL,
  hits   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  incident_id INTEGER REFERENCES incidents(id) ON DELETE CASCADE,
  message     TEXT    NOT NULL,
  link        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- Tamper-evident, append-only audit trail (see src/server/audit.ts).
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  actor_id    INTEGER,
  actor_email TEXT,
  actor_role  TEXT,
  action      TEXT    NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  outcome     TEXT    NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure', 'denied')),
  ip          TEXT,
  user_agent  TEXT,
  request_id  TEXT,
  details     TEXT    NOT NULL DEFAULT '{}',
  prev_hash   TEXT    NOT NULL,
  hash        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only: updates are not permitted');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only: deletes are not permitted');
END;
`;
