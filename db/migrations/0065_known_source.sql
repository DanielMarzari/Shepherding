-- Separate the "who do you know" marks by which page they came from (/know vs
-- /present), so each can be reported on independently. Existing marks are all
-- from /know. Recreate the table with `source` in the primary key so the same
-- shepherd can mark the same person on both pages.
ALTER TABLE shepherd_known_people RENAME TO shepherd_known_people_old;

CREATE TABLE shepherd_known_people (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'know',   -- 'know' | 'present'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, shepherd_person_id, person_id, source)
);

INSERT INTO shepherd_known_people (org_id, shepherd_person_id, person_id, source, created_at)
  SELECT org_id, shepherd_person_id, person_id, 'know', created_at FROM shepherd_known_people_old;

DROP TABLE shepherd_known_people_old;

CREATE INDEX IF NOT EXISTS shepherd_known_people_person ON shepherd_known_people(org_id, person_id);
CREATE INDEX IF NOT EXISTS shepherd_known_people_source ON shepherd_known_people(org_id, source);
