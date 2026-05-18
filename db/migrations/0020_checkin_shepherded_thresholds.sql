-- Two-knob rule for "this kid counts as shepherded via check-ins":
--   shepherded_checkin_min_events: must have at least N check-ins...
--   shepherded_checkin_window_months: ...within the last M months.
-- Default 3 events / 12 months — a kid showing up once isn't yet
-- recurring-enough to mark as shepherded; that signal is Active.
ALTER TABLE pco_sync_settings
  ADD COLUMN shepherded_checkin_min_events INTEGER NOT NULL DEFAULT 3;
ALTER TABLE pco_sync_settings
  ADD COLUMN shepherded_checkin_window_months INTEGER NOT NULL DEFAULT 12;
