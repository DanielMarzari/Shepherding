-- Pre-aggregated tables so dashboard / lanes / home pages don't
-- re-assemble the same totals from scratch on every request. Each is
-- a materialized view in the SQLite-doesn't-have-them sense: regular
-- tables rebuilt by refreshDashboardSnapshots() after every PCO
-- sync, plus on-demand from the admin UI.
--
-- These don't replace the canonical tables (pco_people,
-- pco_event_attendances, etc.) — those stay the source of truth.
-- These exist purely to keep page renders fast.

-- ─── Per-person rollup ─────────────────────────────────────────
-- One row per person. last_activity_at is the max across all signal
-- sources, so a single ORDER BY drives the "Falling through the
-- cracks" list without any CTE acrobatics on the read path.
CREATE TABLE IF NOT EXISTS person_activity (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  last_form_at TEXT,
  last_check_in_at TEXT,
  last_attended_at TEXT,
  last_served_at TEXT,
  last_pco_updated_at TEXT,
  last_activity_at TEXT,
  active_group_count INTEGER NOT NULL DEFAULT 0,
  active_team_count INTEGER NOT NULL DEFAULT 0,
  -- Lane flags so /lanes can do single-table COUNTs.
  in_lane_wors INTEGER NOT NULL DEFAULT 0,
  in_lane_comm INTEGER NOT NULL DEFAULT 0,
  in_lane_serv INTEGER NOT NULL DEFAULT 0,
  -- Computed classification ("shepherded"|"active"|"present"|"inactive")
  -- using the org's current activity-window setting.
  classification TEXT,
  refreshed_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, person_id)
);
CREATE INDEX IF NOT EXISTS person_activity_last_act
  ON person_activity(org_id, last_activity_at);
CREATE INDEX IF NOT EXISTS person_activity_classification
  ON person_activity(org_id, classification);

-- ─── Per-group rollup ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_summary (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  members INTEGER NOT NULL DEFAULT 0,
  leaders INTEGER NOT NULL DEFAULT 0,
  joined_30d INTEGER NOT NULL DEFAULT 0,
  left_30d INTEGER NOT NULL DEFAULT 0,
  attended_distinct_window INTEGER NOT NULL DEFAULT 0,
  events_window INTEGER NOT NULL DEFAULT 0,
  attendance_pct REAL,
  state TEXT,
  refreshed_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, group_id)
);
CREATE INDEX IF NOT EXISTS group_summary_members
  ON group_summary(org_id, members DESC);

-- ─── Org-wide singleton ────────────────────────────────────────
-- One row per org. Headline counters for /home + /lanes top strip.
-- Rebuilt in the same refresh pass that builds person_activity.
CREATE TABLE IF NOT EXISTS org_snapshot (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  total_people INTEGER NOT NULL DEFAULT 0,
  shepherded_count INTEGER NOT NULL DEFAULT 0,
  active_count INTEGER NOT NULL DEFAULT 0,
  present_count INTEGER NOT NULL DEFAULT 0,
  inactive_count INTEGER NOT NULL DEFAULT 0,
  unshepherded_count INTEGER NOT NULL DEFAULT 0,
  joined_30d INTEGER NOT NULL DEFAULT 0,
  departed_30d INTEGER NOT NULL DEFAULT 0,
  lane_wors INTEGER NOT NULL DEFAULT 0,
  lane_comm INTEGER NOT NULL DEFAULT 0,
  lane_serv INTEGER NOT NULL DEFAULT 0,
  lane_none INTEGER NOT NULL DEFAULT 0,
  /** Activity-month threshold used to compute these rollups, so the
   *  UI can tell if a snapshot is stale relative to current settings. */
  activity_months INTEGER NOT NULL DEFAULT 6,
  refreshed_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
