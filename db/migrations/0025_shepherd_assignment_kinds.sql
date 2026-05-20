-- Expand the shepherd_assignments.target_kind whitelist with three
-- new kinds:
--   membership_type — oversee everyone of a PCO membership type
--   shepherd_team   — oversee everyone else on the shepherd team
--                     (the shepherd-team "team leader" role)
--   reference_list  — oversee the members of a REFERENCE list
--                     (staff, elders, deacons, etc.)
--
-- SQLite can't ALTER a CHECK constraint, so the table is recreated.
-- Nothing references shepherd_assignments, so a plain
-- rename / copy / drop inside one transaction is safe.

BEGIN;

ALTER TABLE shepherd_assignments RENAME TO shepherd_assignments_old;

CREATE TABLE shepherd_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  target_kind TEXT NOT NULL
    CHECK (target_kind IN (
      'group', 'group_type', 'team', 'service_type',
      'team_position', 'person', 'membership_type',
      'shepherd_team', 'reference_list'
    )),
  target_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (org_id, shepherd_person_id, target_kind, target_id)
);

INSERT INTO shepherd_assignments
  (id, org_id, shepherd_person_id, target_kind, target_id, note, created_at)
SELECT id, org_id, shepherd_person_id, target_kind, target_id, note, created_at
  FROM shepherd_assignments_old;

DROP TABLE shepherd_assignments_old;

CREATE INDEX IF NOT EXISTS shepherd_assignments_org_shep
  ON shepherd_assignments(org_id, shepherd_person_id);
CREATE INDEX IF NOT EXISTS shepherd_assignments_org_target
  ON shepherd_assignments(org_id, target_kind, target_id);

COMMIT;
