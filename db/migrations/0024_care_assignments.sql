-- Second manual overlay (alongside shepherd_assignments): direct
-- person-to-shepherd care assignments.
--
-- Where shepherd_assignments connects a shepherd to a structural
-- context (a group, a team, a type), care_assignments connects a
-- shepherd to a single *person* they've taken responsibility to care
-- for — pray for them, send a card, make a touch point.
--
-- The intent is coverage for people who AREN'T already shepherded
-- through a group/team. A person is expected to have exactly one
-- carer, so UNIQUE is on (org_id, person_id) — that also makes the
-- "who has no carer yet" query a simple NOT IN.
--
-- When a person becomes shepherded they no longer need a manual care
-- touch point; the care-map read layer hides shepherded people and
-- the server actions prune their rows, so coverage stays honest.

CREATE TABLE IF NOT EXISTS care_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (org_id, person_id)
);

CREATE INDEX IF NOT EXISTS care_assignments_org_shep
  ON care_assignments(org_id, shepherd_person_id);
