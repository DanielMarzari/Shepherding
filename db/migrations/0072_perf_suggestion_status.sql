-- Per-org status for the performance optimization backlog. The suggestions
-- themselves are authored in code (src/lib/perf-suggestions.ts) — this table
-- only records what an admin has decided about each one (approve / applied /
-- dismissed) plus an optional note. One row per (org, suggestion key); absent
-- rows fall back to the suggestion's default status.
CREATE TABLE IF NOT EXISTS perf_suggestion_status (
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  status     TEXT NOT NULL,   -- pending | approved | applied | dismissed
  note       TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, key)
);
