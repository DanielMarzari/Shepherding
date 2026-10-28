-- Why a person is inactive in PCO, as the reason's name.
--
-- This is the only place PCO records that someone has died. The "Date of
-- Death" custom field looks like it should be, and the membership audit
-- read it, but only 4 people in the whole database carry one while 143 are
-- marked with the Deceased inactive reason — so the audit's "deceased,
-- still a member" flag was finding 4 of them.
--
-- Stored as the reason's text rather than its id: PCO's reasons are an
-- editable per-organisation list, the names are what the audit matches on,
-- and an id would need a second table to mean anything.
BEGIN IMMEDIATE;

ALTER TABLE pco_people ADD COLUMN inactive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_pco_people_inactive_reason
  ON pco_people (org_id, inactive_reason);

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0114_person_inactive_reason.sql');
COMMIT;
