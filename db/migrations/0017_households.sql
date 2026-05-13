-- PCO Households + membership links. Used to derive the is_parent flag
-- on pco_people (adult in a household with at least one minor) and to
-- power the "has kids" demographic breakdown.
CREATE TABLE IF NOT EXISTS pco_households (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  member_count INTEGER,
  primary_contact_id TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

CREATE TABLE IF NOT EXISTS pco_household_memberships (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_household_memberships_house
  ON pco_household_memberships(org_id, household_id);
CREATE INDEX IF NOT EXISTS pco_household_memberships_person
  ON pco_household_memberships(org_id, person_id);

-- Cached "this adult shares a household with a minor" flag. Lets us
-- segment attendance + demographics by parent status without re-joining
-- households on every read.
ALTER TABLE pco_people ADD COLUMN is_parent INTEGER NOT NULL DEFAULT 0;
