-- The previous full-Shepherdly deploy used the filename 0001_init.sql for a
-- totally different schema. That row in _migrations means our new 0001
-- (which adds the pco_* tables) is skipped on the live server. This
-- migration creates only the PCO tables that 0001 would have created,
-- with IF NOT EXISTS so fresh deploys (where 0001 did run) are no-ops.

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

CREATE TABLE IF NOT EXISTS pco_sync_settings (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('15m', '30m', 'hourly', 'daily', 'weekly', 'monthly')),
  run_at_hour INTEGER NOT NULL DEFAULT 0 CHECK (run_at_hour BETWEEN 0 AND 23),
  email_on_failure INTEGER NOT NULL DEFAULT 1,
  auto_resolve_conflicts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS pco_sync_entities (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, entity)
);

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
