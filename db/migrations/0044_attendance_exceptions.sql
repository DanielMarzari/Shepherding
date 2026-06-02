-- Free-text exception reason per Sunday, parsed from the "Exceptions
-- (exclude from averages)" row of the attendance spreadsheet (e.g.
-- "snow closure", "service cancelled"). When set, the week is kept for
-- display but EXCLUDED from every average and trend, and flagged on the
-- charts so a closure doesn't read as a real low-attendance Sunday.
ALTER TABLE attendance_weekly ADD COLUMN exception_reason TEXT;
