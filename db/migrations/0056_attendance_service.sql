-- Per-service-time, per-room attendance — finer than the room totals in
-- attendance_weekly. Normalized (long) because the service times drift over
-- the years (9:00/10:30 in 2020-21 → 8:00/9:30/11:00 in 2022-23 → 8:00/9:30/
-- 11:15 in 2024+), so fixed columns can't represent them. One row per
-- (week, room, service-time). Online has no per-service split, so it stays a
-- single weekly figure in attendance_weekly.online_live.
CREATE TABLE IF NOT EXISTS attendance_service (
  org_id      INTEGER NOT NULL,
  week_date   TEXT NOT NULL,
  room        TEXT NOT NULL,  -- 'center' | 'chapel' | 'kids' | 'student'
  service     TEXT NOT NULL,  -- service start time, e.g. '8:00', '9:30', '11:15'
  count       INTEGER,
  source_file TEXT,
  PRIMARY KEY (org_id, week_date, room, service)
);
CREATE INDEX IF NOT EXISTS attendance_service_week
  ON attendance_service(org_id, week_date);
