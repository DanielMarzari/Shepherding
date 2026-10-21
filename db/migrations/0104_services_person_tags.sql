-- Services person tags — the thing the Outreach lane actually wanted.
--
-- 0103 let an admin tag whole service types and group types as outreach.
-- That turned out to be the wrong grain: Faith Church records outreach
-- involvement as TAGS ON PEOPLE in Services, not as whole teams. The tag
-- groups carrying it are "Outreach Programs" (ESL Volunteer, Justice
-- Initiatives Volunteer), "Other Outreach" (Local Outreach Volunteer),
-- "Unleashing Servants Team", "Meal Ministry", "Foster Adopt Support",
-- "Directional Task Forces", the Prayer Works and Network Prayer groups,
-- Night To Shine, Fam Fest and Tree Lighting.
--
-- Tagging a whole service type would sweep in everyone rostered to it;
-- tagging "ESL Volunteer" names exactly the people who do that thing.
--
-- Source: /services/v2/people?include=tags — 3,481 Services people, ~35
-- pages. Services shares PCO's person ids, so person_id joins pco_people
-- directly. No FK on it: a tag can arrive for somebody the people sync has
-- filtered out (looksLikeNonPerson), and losing the tag row would be worse
-- than keeping an orphan.

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS pco_tag_groups (
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id     TEXT NOT NULL,
  name       TEXT,
  -- "person", "song", "arrangement"… Only person groups reach the picker.
  tags_for   TEXT,
  synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, pco_id)
);

CREATE TABLE IF NOT EXISTS pco_tags (
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id       TEXT NOT NULL,
  tag_group_id TEXT NOT NULL,
  name         TEXT,
  synced_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_tags_group
  ON pco_tags(org_id, tag_group_id);

CREATE TABLE IF NOT EXISTS pco_person_tags (
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL,
  tag_id     TEXT NOT NULL,
  synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, person_id, tag_id)
);
-- Leading tag_id: the Outreach lane asks "who holds any of these tags",
-- which is a scan of a handful of tag ids, never of a person.
CREATE INDEX IF NOT EXISTS pco_person_tags_tag
  ON pco_person_tags(org_id, tag_id, person_id);

-- Individual tag pco_ids that count as outreach. Sits beside
-- outreach_service_types / outreach_group_types from 0103; all three are
-- unioned, so an admin can mix grains (a whole prayer service type plus a
-- single "ESL Volunteer" tag) without the lane double-counting anyone.
ALTER TABLE pco_sync_settings ADD COLUMN outreach_tags TEXT;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0104_services_person_tags.sql');
COMMIT;
