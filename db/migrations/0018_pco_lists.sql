-- PCO People > Lists imported into Shepherding. We only sync lists
-- whose NAME starts with "REFERENCE " — convention the church uses for
-- the rosters we actually want to surface (staff, deacons, elders,
-- shepherd team, etc.). Other lists are ignored.
CREATE TABLE IF NOT EXISTS pco_lists (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  total_people INTEGER,
  refreshed_at TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_lists_name ON pco_lists(org_id, name);

CREATE TABLE IF NOT EXISTS pco_list_memberships (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, list_id, person_id)
);
CREATE INDEX IF NOT EXISTS pco_list_memberships_person
  ON pco_list_memberships(org_id, person_id);
CREATE INDEX IF NOT EXISTS pco_list_memberships_list
  ON pco_list_memberships(org_id, list_id);
