-- What counts as seniors, recorded rather than guessed from names.
--
-- Name matching does not work here and the mockup proved it: searching
-- "SIA" returns SE Asia, Iglesia de Fe and Malaysia; searching "senior"
-- returns HS Senior Trip and Faith High School Senior Celebration, which
-- is the opposite end of the age range. So the seniors audit is told what
-- counts, the same way the outreach lane is, and shows nothing until it
-- has been.
--
-- Same shape as the excluded_* and outreach_* columns beside them: a JSON
-- string array, NULL when nothing is chosen, read through readIdList.
BEGIN IMMEDIATE;

-- Constant Contact lists that are the seniors' mailing list. Both of them
-- today: Seniors' Ministry and the retired SIA list, which still holds
-- people the current one does not.
ALTER TABLE pco_sync_settings ADD COLUMN seniors_cc_lists TEXT;

-- Registration signups, check-in events, group types and groups that are
-- seniors events. Four kinds because that is how PCO holds them, and a
-- person counts as having attended if any one of them says so.
ALTER TABLE pco_sync_settings ADD COLUMN seniors_signups TEXT;
ALTER TABLE pco_sync_settings ADD COLUMN seniors_checkin_events TEXT;
ALTER TABLE pco_sync_settings ADD COLUMN seniors_group_types TEXT;
ALTER TABLE pco_sync_settings ADD COLUMN seniors_groups TEXT;

-- The age that counts, so 65 is a setting rather than a number buried in
-- a query.
ALTER TABLE pco_sync_settings ADD COLUMN seniors_age_min INTEGER;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0116_seniors_audit_settings.sql');
COMMIT;
