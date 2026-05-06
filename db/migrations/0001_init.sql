-- Initial schema: auth + orgs + PCO credentials.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS memberships_org ON memberships(org_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

-- PCO creds: stored AES-256-GCM encrypted. iv + auth_tag + ciphertext are
-- base64-encoded together as one column per secret. Last4 stored plaintext
-- so the UI can show "•••••3f9d" without decrypting.
CREATE TABLE IF NOT EXISTS pco_credentials (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  app_id_enc TEXT,
  app_id_last4 TEXT,
  secret_enc TEXT,
  secret_last4 TEXT,
  webhook_secret_enc TEXT,
  webhook_secret_last4 TEXT,
  organization_name TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- PCO sync schedule + behavior settings.
CREATE TABLE IF NOT EXISTS pco_sync_settings (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('15m', '30m', 'hourly', 'daily', 'weekly', 'monthly')),
  run_at_hour INTEGER NOT NULL DEFAULT 0 CHECK (run_at_hour BETWEEN 0 AND 23),
  email_on_failure INTEGER NOT NULL DEFAULT 1,
  auto_resolve_conflicts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-entity sync toggles. Required entities (people) are not editable.
CREATE TABLE IF NOT EXISTS pco_sync_entities (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, entity)
);

-- Sync run log.
CREATE TABLE IF NOT EXISTS pco_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  changes INTEGER NOT NULL DEFAULT 0,
  warning TEXT
);
CREATE INDEX IF NOT EXISTS pco_runs_org ON pco_sync_runs(org_id, started_at DESC);
