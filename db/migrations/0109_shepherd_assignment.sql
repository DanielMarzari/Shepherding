-- Assigning everyone in Known to somebody on the shepherd team.
--
-- Two new tables, deliberately NOT care_assignments. That one is the care
-- map's: a short list of people somebody is actively caring for, three rows
-- today, and it feeds the careNonShepherded bucket in the team breakdown.
-- Pouring 4,556 roster assignments into it would quietly change what every
-- existing reader of that table means.
--
-- The separation also matches how the page reads: "by role" (what somebody
-- already oversees through a group or team, from shepherd_assignments) and
-- "assigned" (handed to them here) are two different numbers on purpose.

BEGIN IMMEDIATE;

-- How many people a shepherd is responsible for getting connected. NOT a
-- relational-capacity figure and deliberately uncapped — one person may
-- carry 40, another 400, depending on what their role actually is.
-- No row means not set yet, which the page shows as such rather than
-- inventing a default and quietly counting it toward team capacity.
CREATE TABLE IF NOT EXISTS shepherd_bandwidth (
  org_id             INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  max_people         INTEGER NOT NULL,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, shepherd_person_id)
);

-- One shepherd per person, enforced by the primary key rather than by
-- hoping the UI never double-assigns. Re-assigning is an upsert.
--
-- source records how it happened — 'bulk' (the one uncontested claimant),
-- 'contested' (somebody chose between claimants), 'manual' (picked from the
-- pool), 'auto' (assigned in bulk by the allocator). Without it an auto-run
-- of 3,968 rows would be indistinguishable from deliberate decisions, and
-- undoing a bad auto-run would mean undoing everything.
CREATE TABLE IF NOT EXISTS shepherd_person_assignments (
  org_id             INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id          TEXT NOT NULL,
  shepherd_person_id TEXT NOT NULL,
  source             TEXT NOT NULL DEFAULT 'manual',
  assigned_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, person_id)
);

-- The page's hottest question is "how many has this shepherd got", so the
-- index leads with the shepherd.
CREATE INDEX IF NOT EXISTS shepherd_person_assignments_shepherd
  ON shepherd_person_assignments(org_id, shepherd_person_id);

-- shepherd_known_people is what makes a person uncontested, contested or
-- unclaimed, and the page's question is "how many DISTINCT shepherds named
-- this person". 0065 already indexes (org_id, person_id); adding the
-- shepherd as a third column makes that count index-only. A separate name
-- on purpose — reusing shepherd_known_people_person would be a silent
-- no-op against the index 0065 already created.
CREATE INDEX IF NOT EXISTS shepherd_known_people_person_shepherd
  ON shepherd_known_people(org_id, person_id, shepherd_person_id);

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0109_shepherd_assignment.sql');
COMMIT;
