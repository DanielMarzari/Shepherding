-- One naming rule for dates: `_at` holds a full ISO instant, `_on` holds a
-- calendar date (YYYY-MM-DD).
--
-- `_date` meant both. cc_contacts.opt_in_date holds full timestamps such as
-- '2012-05-02T21:02:31Z', so `WHERE opt_in_date = '2026-09-14'` matched none of
-- its 8,674 values and looked like missing data to anyone browsing the
-- database. sermons.preached_on, sermons.released_on and
-- pushpay_transactions.received_on already follow the rule, and every other
-- `_at` and `_on` column already holds what its suffix says.
--
-- What each column holds, measured on the 2026-09-21 production copy:
--
--   cc_contacts.opt_in_date            -> opted_in_at    8,674 values, all 'YYYY-MM-DDTHH:MM:SSZ'
--   cc_contacts.opt_out_date           -> opted_out_at   6,054 values, same shape
--   cc_contact_activity.activity_time  -> occurred_at    234,314 values, all '...T...:SS.sssZ'
--   cc_campaigns.last_sent_date        -> last_sent_at   4,521 values, all '...T...:SS.sssZ'
--   pco_person_fields.value_date       -> value_on       1,094 values, all 'YYYY-MM-DD' (Baptism,
--                                                        normalized from PCO's '06/29/2003')
--   pushpay_donors.last_gift_date      -> last_gift_on   6,415 values, all 'YYYY-MM-DD'
--   pushpay_donors.first_gift_date     -> first_gift_on  empty; the importer writes it with the
--                                                        same YYYY-MM-DD parser as last_gift_date
--
--   pco_check_ins.event_time_at -> event_time_starts_at. In PCO Check-Ins an
--   EventTime is one occurrence of an event (the 11:15 on 2026-09-20), and the
--   sync stores starts_at of the first EventTime the check-in belongs to. It is
--   true UTC, unlike pco_plans.sort_date: '2026-09-20T15:15:00Z' is the 11:15
--   service. 264,735 of the 276,591 check-ins were created within two hours of
--   it. The old name read as the time of the check-in, which is pco_created_at.
--
--   attendance_weekly.week_date and attendance_service.week_date -> sunday_on.
--   It is the date in the header row of the "Worship and Activities Attendance"
--   spreadsheets, one column per Sunday, and it is the day the services were
--   held: /attendance matches it day for day to that Sunday's service plans (the
--   preacher overlay) and to that day's weather. Not week_starting_on: nothing
--   treats it as the start of a range. 271 of the 280 weekly rows and 2,364 of
--   the 2,418 service rows are Sundays. The other 9 and 54 are Fridays,
--   2020-01-03 to 2020-02-28, all from the "2021 Q1" file, and each is exactly
--   one year before a Sunday in January or February 2021 that the file has no
--   row for: that sheet's headers carry the wrong year. Renaming leaves them as
--   they are. A corrected re-import adds the 2021 rows, and the misdated ones
--   then have to be deleted by hand.
--
-- Not renamed: pco_plans.sort_date. It is PCO's own attribute name, 157
-- references in src/ and scripts/ and 43 stored blocks and Undo snapshots use
-- it, and it fits neither suffix: it holds the local service time with a
-- nominal Z ('2026-09-13T08:00:00Z' is the 8 am service). Compare it by
-- calendar date, as mir-metrics.ts does with `sort_date < ${TOMORROW}` (see
-- 0090).
--
-- RENAME COLUMN rewrites the schema only: the table definitions, the primary
-- keys of attendance_weekly and attendance_service, and the indexes that name
-- these columns (cc_campaigns_sent, pco_check_ins_person_time,
-- pco_person_fields_by_field, attendance_weekly_org_week,
-- attendance_service_week). No row is rewritten. No view or trigger exists, and
-- no index name contains an old column name, so no index is recreated.
--
-- Stored builder SQL is rewritten in the same transaction, as 0090 did. On the
-- 2026-09-21 copy, a word-boundary search of builder_blocks.config and
-- builder_page_versions.snapshot finds last_sent_date 16 times in 9 blocks,
-- week_date 25 times in 16 blocks, last_gift_date 6 times in 3 blocks and 21
-- times in 7 Undo snapshots, and value_date 3 times in 2 blocks. The other five
-- names do not occur. Every occurrence is the column itself, bare or qualified
-- (cc., f., aw.), inside a query. None is part of a longer identifier, an alias
-- or a label. No other table has a column with any of the old or new names,
-- and no stored text uses a new name yet, so plain replace() is exact. All
-- nine are replaced, which also covers a query saved between that copy and
-- this deploy. The names hold nothing JSON escapes, so the same replace works
-- in config and in snapshot, where each config is a JSON string inside JSON.
-- On that copy this rewrites 30 blocks and 7 snapshots and leaves none of the
-- old names behind; every rewritten query still runs and returns the same
-- rows.
--
-- Seeded pages stay consistent, as in 0090. Only config and snapshot text
-- change. builder_pages is not touched, so no page starts to look edited. The
-- Ministry Impact Report templates in src/lib/mir-metrics.ts use the new names,
-- so their fingerprints change and each pristine page is replaced once from its
-- template. Where the page was current, the new blocks are byte-identical to
-- what this wrote. The hand-numbered seeds whose SQL changed (attendance,
-- email-dashboard, giving in src/lib/builder-seeds.ts) went up one revision, so
-- a pristine copy that the old code creates during the deploy, with the old
-- names, is replaced too. The edited Giving page is never replaced, so this
-- migration is the only thing that fixes it.
--
-- The old code keeps serving between this migration and the pm2 restart, and
-- for those few seconds anything it runs against these columns fails with "no
-- such column". A sync caught mid-write there fails and the next run redoes it.
--
-- IMMEDIATE for the reason 0092 gives: take the write lock, waiting for it,
-- before the first read. If any statement fails, nothing is renamed: the
-- transaction is still open when db.exec throws and is rolled back when the
-- deploy's process exits. Re-run from the top.
BEGIN IMMEDIATE;

ALTER TABLE cc_contacts RENAME COLUMN opt_in_date TO opted_in_at;
ALTER TABLE cc_contacts RENAME COLUMN opt_out_date TO opted_out_at;
ALTER TABLE cc_contact_activity RENAME COLUMN activity_time TO occurred_at;
ALTER TABLE cc_campaigns RENAME COLUMN last_sent_date TO last_sent_at;
ALTER TABLE pco_person_fields RENAME COLUMN value_date TO value_on;
ALTER TABLE pushpay_donors RENAME COLUMN last_gift_date TO last_gift_on;
ALTER TABLE pushpay_donors RENAME COLUMN first_gift_date TO first_gift_on;
ALTER TABLE pco_check_ins RENAME COLUMN event_time_at TO event_time_starts_at;
ALTER TABLE attendance_weekly RENAME COLUMN week_date TO sunday_on;
ALTER TABLE attendance_service RENAME COLUMN week_date TO sunday_on;

UPDATE builder_blocks
   SET config =
       replace(replace(replace(replace(replace(replace(replace(replace(replace(config,
         'opt_in_date',     'opted_in_at'),
         'opt_out_date',    'opted_out_at'),
         'activity_time',   'occurred_at'),
         'last_sent_date',  'last_sent_at'),
         'value_date',      'value_on'),
         'last_gift_date',  'last_gift_on'),
         'first_gift_date', 'first_gift_on'),
         'event_time_at',   'event_time_starts_at'),
         'week_date',       'sunday_on')
 WHERE instr(config, 'opt_in_date') > 0 OR instr(config, 'opt_out_date') > 0
    OR instr(config, 'activity_time') > 0 OR instr(config, 'last_sent_date') > 0
    OR instr(config, 'value_date') > 0 OR instr(config, 'last_gift_date') > 0
    OR instr(config, 'first_gift_date') > 0 OR instr(config, 'event_time_at') > 0
    OR instr(config, 'week_date') > 0;

UPDATE builder_page_versions
   SET snapshot =
       replace(replace(replace(replace(replace(replace(replace(replace(replace(snapshot,
         'opt_in_date',     'opted_in_at'),
         'opt_out_date',    'opted_out_at'),
         'activity_time',   'occurred_at'),
         'last_sent_date',  'last_sent_at'),
         'value_date',      'value_on'),
         'last_gift_date',  'last_gift_on'),
         'first_gift_date', 'first_gift_on'),
         'event_time_at',   'event_time_starts_at'),
         'week_date',       'sunday_on')
 WHERE instr(snapshot, 'opt_in_date') > 0 OR instr(snapshot, 'opt_out_date') > 0
    OR instr(snapshot, 'activity_time') > 0 OR instr(snapshot, 'last_sent_date') > 0
    OR instr(snapshot, 'value_date') > 0 OR instr(snapshot, 'last_gift_date') > 0
    OR instr(snapshot, 'first_gift_date') > 0 OR instr(snapshot, 'event_time_at') > 0
    OR instr(snapshot, 'week_date') > 0;

COMMIT;
