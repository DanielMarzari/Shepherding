-- Status rows for snapshot refresh jobs. We mirror the pco_sync_runs
-- pattern so the client can poll progress from any process worker —
-- in-memory state wouldn't survive a PM2 cluster restart, and a refresh
-- is too long to block a server action on.
CREATE TABLE IF NOT EXISTS dashboard_refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 4,
  step_label TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS dashboard_refresh_runs_org
  ON dashboard_refresh_runs(org_id, started_at DESC);
