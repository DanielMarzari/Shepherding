-- "What defines being Known at Faith Church" — made configurable.
--
-- The classification vocabulary is now Shepherded / Known / Unknown.
-- Shepherded and Unknown are measured; Known is the residual. So the ONLY
-- thing that needs defining is Unknown, and the whole question reduces to:
-- which signals count as this person doing something, and how recently.
--
-- That was hard-coded, and hard-coded badly: the test looked at form
-- submissions, check-ins, and edits to the PCO record. Measured against the
-- member roster, adding the signals it ignored moves 285 people out of the
-- bottom band — 243 of them on email opens alone, 96 on giving, 60 on
-- registrations. Adults rarely check in and rarely submit forms, so the two
-- original signals were close to blind for exactly the people the
-- classification is meant to describe.
--
-- An edit to the PCO record is deliberately NOT a signal and cannot be
-- enabled here. It is activity ON a person by a staff member, not BY them;
-- counting it would mean a data cleanup could silently promote hundreds of
-- people into Known.

BEGIN IMMEDIATE;

-- JSON array of signal keys. NULL means "never configured" and the app
-- falls back to its default set, so an org that never visits the settings
-- page still gets a sane definition rather than an empty one.
--   checkin · form · attendance · serving · giving · email · registration
ALTER TABLE pco_sync_settings ADD COLUMN known_signals TEXT;

-- How many DISTINCT kinds of signal a person needs inside the window to
-- clear the bar. 1 by default: one real action in eleven months is a low
-- bar, but it is the bar the previous code implied, and raising it is a
-- decision with pastoral consequences that belongs to the church, not to a
-- default. Counting distinct KINDS rather than raw events on purpose —
-- comparing "3 email opens" against "3 gifts" as though they were the same
-- unit would be meaningless.
ALTER TABLE pco_sync_settings ADD COLUMN known_min_signals INTEGER NOT NULL DEFAULT 1;

-- The window itself already exists as pco_sync_settings.activity_months
-- (currently 11) and is reused rather than duplicated, so the audit, the
-- lanes and this definition can never drift apart.

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0105_known_definition.sql');
COMMIT;
