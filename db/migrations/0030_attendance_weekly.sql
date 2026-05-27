-- Weekly Sunday-attendance numbers parsed from historical spreadsheets
-- (the "Worship and Activities Attendance - YYYY QN.xlsx" series, plus
-- a couple of online-only files from 2020). Each row is one Sunday; we
-- store the subtotals separately so /attendance can chart them by
-- category. `source_file` is kept for traceability when a spreadsheet
-- is re-imported with corrections.
CREATE TABLE IF NOT EXISTS attendance_weekly (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  week_date TEXT NOT NULL, -- ISO 'YYYY-MM-DD' for the Sunday
  -- All counts are nullable — older quarters may only have some.
  in_person_total INTEGER,
  kids_total INTEGER,
  student_total INTEGER,
  adult_total INTEGER,
  online_live INTEGER,
  online_on_demand INTEGER,
  abfs INTEGER,
  source_file TEXT,
  imported_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, week_date)
);
CREATE INDEX IF NOT EXISTS attendance_weekly_org_week
  ON attendance_weekly(org_id, week_date);
