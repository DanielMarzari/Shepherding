-- Inverted semantics for the check-in event filter. Original column
-- name implied a "shepherded events list" (only these count). We now
-- treat all check-in events as kid/student events by default, and the
-- admin-flagged list is the EXCLUSION list (Office Visitors, Volunteer
-- Sign-up, etc.). Data shape is identical; only the meaning changes.
ALTER TABLE pco_sync_settings
  RENAME COLUMN shepherded_checkin_events TO excluded_checkin_events;
