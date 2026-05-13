-- PCO Check-Ins data
-- ──────────────────────────────────────────────────────────────────────
-- Events that people check in to (kids services, student gatherings,
-- discover-faith classes, visitor check-in, etc.)
CREATE TABLE IF NOT EXISTS pco_checkin_events (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  frequency TEXT,
  archived_at TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

-- Locations attached to events (Room 101, Nursery, etc.)
CREATE TABLE IF NOT EXISTS pco_checkin_locations (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  kind TEXT,           -- "Folder" | "Location" (PCO's classification)
  parent_id TEXT,      -- another location's pco_id (folders nest)
  archived_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

-- Individual check-in records. One row per check-in event-time, per
-- person. `kind` is PCO's enum: "regular", "guest", "volunteer".
CREATE TABLE IF NOT EXISTS pco_check_ins (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  person_id TEXT,             -- who's being checked in (nullable: guest check-ins may not link)
  event_id TEXT,
  event_time_at TEXT,         -- denormalized from event_times include
  location_id TEXT,           -- one of the linked locations (we take the first)
  checked_in_by_id TEXT,      -- parent / leader doing the check-in
  checked_out_by_id TEXT,
  kind TEXT,                  -- regular | guest | volunteer
  checked_out_at TEXT,
  pco_created_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_check_ins_person       ON pco_check_ins(org_id, person_id);
CREATE INDEX IF NOT EXISTS pco_check_ins_event        ON pco_check_ins(org_id, event_id);
CREATE INDEX IF NOT EXISTS pco_check_ins_checker_in   ON pco_check_ins(org_id, checked_in_by_id);
CREATE INDEX IF NOT EXISTS pco_check_ins_checker_out  ON pco_check_ins(org_id, checked_out_by_id);
CREATE INDEX IF NOT EXISTS pco_check_ins_created      ON pco_check_ins(org_id, pco_created_at DESC);

-- Cached "last check-in touched by this person" timestamp. Set by
-- refreshLastCheckIn(); aggregates being-checked-in, doing-the-checking-in,
-- and doing-the-checking-out, since any role counts as activity.
ALTER TABLE pco_people ADD COLUMN last_check_in_at TEXT;

-- JSON array of check-in event pco_ids that count as "shepherded" — kids /
-- student events where being checked in means someone is caring for that
-- person by name. Admin opts events in via /pco/filters → Check-in events.
ALTER TABLE pco_sync_settings ADD COLUMN shepherded_checkin_events TEXT;
