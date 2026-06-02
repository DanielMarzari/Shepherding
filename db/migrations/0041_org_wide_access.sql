-- Whole-organization access exceptions. The long-term model is that a
-- shepherd's access is scoped to what they oversee on the shepherd map
-- (their ministry areas). This table is the escape hatch: a
-- shepherd-team member listed here can see the WHOLE org, not just
-- their scoped slice. Enforcement (the actual scoping/filtering of
-- every page) comes later — for now this just records the intent so
-- the admin can designate the exceptions.
CREATE TABLE IF NOT EXISTS org_wide_access (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, person_id)
);
