-- PCO Check-Ins HEADCOUNTS: the upstream source of the attendance numbers.
--
-- Not individual check-ins (pco_check_ins, 275k rows of who walked in) but the
-- aggregate a volunteer types in per service per venue. PCO calls them
-- Headcounts and they hang off an EventTime and an AttendanceType.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS. The quarterly spreadsheet in
-- attendance_weekly turns out to be a MANUAL TRANSCRIPTION of these. Measured
-- over 35 Sundays from Sep 2025:
--   W-Center + W-Chapel + W-Loft  ==  adult_total   (median difference 0)
--   On-YT Live + On-ChOnline      ==  online_live   (median difference 0)
-- On-App is deliberately NOT in the sheet's online_live; adding it puts the
-- figure out by +43. So PCO is upstream and the sheet is downstream, which
-- means the sheet's gaps can be filled from here rather than waiting on a
-- quarterly export.
--
-- And the history is not "a few weeks": W-Center runs from 2020-11-01,
-- W-Chapel from 2021-02-28, the online channels from 2021-04-25, and parking
-- counts from 2017-12-03. 7,692 headcounts in all.
--
-- local_date and local_time are America/New_York, computed at sync time with
-- Intl rather than a fixed UTC offset, because a fixed offset mis-dates
-- anything near midnight for half the year (the same bug that put 197 all-day
-- calendar events on the wrong day).
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS pco_headcounts (
  org_id             INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id             TEXT NOT NULL,
  event_time_id      TEXT,
  attendance_type_id TEXT,
  attendance_type    TEXT,   -- 'W-Center', 'On-YT Live', 'ABF', ...
  event_name         TEXT,   -- the check-in event the type belongs to
  starts_at          TEXT,   -- the event time, UTC ISO
  local_date         TEXT,   -- America/New_York date, 'YYYY-MM-DD'
  local_time         TEXT,   -- America/New_York time, 'HH:MM'
  total              INTEGER,
  pco_created_at     TEXT,
  pco_updated_at     TEXT,
  synced_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_headcounts_date ON pco_headcounts(org_id, local_date);
CREATE INDEX IF NOT EXISTS pco_headcounts_type ON pco_headcounts(org_id, attendance_type, local_date);

-- Which columns on an attendance_weekly row were filled from PCO rather than
-- from the spreadsheet. A JSON array of column names, so provenance survives:
-- the projection never overwrites a value the sheet actually carried, and this
-- records what it did add.
ALTER TABLE attendance_weekly ADD COLUMN pco_filled TEXT;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0101_pco_headcounts.sql');
COMMIT;
