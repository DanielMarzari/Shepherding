-- Per-event attendance records (one row per (event, person) when PCO has it).
CREATE TABLE IF NOT EXISTS pco_event_attendances (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  group_id TEXT,
  attended INTEGER NOT NULL,
  pco_created_at TEXT,
  event_starts_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, event_id, person_id)
);
CREATE INDEX IF NOT EXISTS pco_event_attendances_person
  ON pco_event_attendances(org_id, person_id);
CREATE INDEX IF NOT EXISTS pco_event_attendances_group
  ON pco_event_attendances(org_id, group_id);

-- Cached "last attended this group" timestamp per membership. Recomputed
-- at the end of every sync from pco_event_attendances + pco_group_events.
ALTER TABLE pco_group_memberships ADD COLUMN last_attended_at TEXT;

-- "Stops attending for N weeks" threshold for marking a member as lapsed
-- (default 10). Configured on the Metrics page.
ALTER TABLE pco_sync_settings ADD COLUMN lapsed_weeks INTEGER NOT NULL DEFAULT 10;
