-- A durable "the inactive-reason backfill has run" marker.
--
-- 0114 added pco_people.inactive_reason, and the first backfill guarded
-- itself on the column being entirely empty. That is wrong by one pass: the
-- incremental people sync writes the reason for everyone whose record
-- changed, so by the time the backfill checked, rows already existed and it
-- skipped — permanently. 316 of 17,206 inactive people were filled and the
-- rest never would be.
--
-- "Has this run" is a fact about the sync, not something inferable from the
-- data, so it is recorded rather than guessed at.
BEGIN IMMEDIATE;

ALTER TABLE pco_sync_settings ADD COLUMN inactive_reason_backfilled_at TEXT;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0115_inactive_reason_backfill_flag.sql');
COMMIT;
