-- Which tab a custom field sits on.
--
-- The Congregational Meetings tab holds twenty fields whose names follow
-- no single shape: "Annual Meeting - June 2024", "Annual Meeting - March
-- 2012", "Congregational Vote - 9/18/2016", "Congregational Vote -
-- September 2022". Asking "is this a meeting field" by matching those
-- names means guessing, and guessing wrong the first time somebody names
-- one "Special Meeting 2027".
--
-- The sync already reads the tab to decide what to pull (the tab
-- allowlist), so it has the answer and was throwing it away. Storing it
-- makes "every vote this person has cast" an exact query instead of a
-- LIKE over two patterns.
BEGIN IMMEDIATE;

ALTER TABLE pco_person_fields ADD COLUMN tab TEXT;

CREATE INDEX IF NOT EXISTS pco_person_fields_by_tab
  ON pco_person_fields(org_id, tab, person_id);

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0122_person_field_tab.sql');
COMMIT;
