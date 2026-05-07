-- New PCO Groups data
CREATE TABLE IF NOT EXISTS pco_group_types (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

CREATE TABLE IF NOT EXISTS pco_groups (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  schedule TEXT,
  group_type_id TEXT,
  pco_created_at TEXT,
  archived_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_groups_org_type ON pco_groups(org_id, group_type_id);

CREATE TABLE IF NOT EXISTS pco_group_memberships (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  role TEXT,
  joined_at TEXT,
  archived_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_group_memberships_person ON pco_group_memberships(org_id, person_id);
CREATE INDEX IF NOT EXISTS pco_group_memberships_group ON pco_group_memberships(org_id, group_id);
CREATE INDEX IF NOT EXISTS pco_group_memberships_active ON pco_group_memberships(org_id, archived_at);

CREATE TABLE IF NOT EXISTS pco_group_applications (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  group_id TEXT,
  person_id TEXT,
  applied_at TEXT,
  status TEXT,
  has_message INTEGER,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_group_apps_person ON pco_group_applications(org_id, person_id);
CREATE INDEX IF NOT EXISTS pco_group_apps_group ON pco_group_applications(org_id, group_id);
CREATE INDEX IF NOT EXISTS pco_group_apps_applied ON pco_group_applications(org_id, applied_at DESC);

CREATE TABLE IF NOT EXISTS pco_group_events (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  group_id TEXT,
  starts_at TEXT,
  attendance_requests_enabled INTEGER,
  automated_reminder_enabled INTEGER,
  canceled INTEGER,
  canceled_at TEXT,
  reminders_sent INTEGER,
  reminders_sent_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_group_events_group ON pco_group_events(org_id, group_id, starts_at DESC);

-- Activity-tracking window (e.g. "5 people joined groups in the last X months")
ALTER TABLE pco_sync_settings ADD COLUMN activity_tracking_months INTEGER NOT NULL DEFAULT 3;

-- Weekly Sunday attendance (manually entered) — used to compute the
-- attendance frequency rate (active people / weekly attendance).
ALTER TABLE pco_sync_settings ADD COLUMN weekly_attendance INTEGER;

-- Rename the entity toggle key for clarity. The single "groups" toggle
-- now controls the entire Groups data set: types, groups, memberships,
-- applications, and events.
UPDATE pco_sync_entities SET entity = 'groups' WHERE entity = 'group_memberships';
