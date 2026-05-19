-- Manual overlay on top of PCO: who oversees whom.
--
-- A "shepherd" here is a person on the REFERENCE - Shepherd Team list.
-- Each assignment row says "this shepherd oversees this target". The
-- target can be a single group/team, an entire category (group type,
-- service type), a specific position on a team (e.g. all Sound Techs),
-- or another shepherd (peer hierarchy / shepherd-over-shepherd).
--
-- We store the target as (kind, id) instead of separate FK columns so
-- new target kinds don't require a schema change.

CREATE TABLE IF NOT EXISTS shepherd_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  target_kind TEXT NOT NULL
    CHECK (target_kind IN (
      'group', 'group_type', 'team', 'service_type',
      'team_position', 'person'
    )),
  target_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (org_id, shepherd_person_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS shepherd_assignments_org_shep
  ON shepherd_assignments(org_id, shepherd_person_id);
CREATE INDEX IF NOT EXISTS shepherd_assignments_org_target
  ON shepherd_assignments(org_id, target_kind, target_id);
