-- Cached daily weather for Trexlertown, PA (the church's location), so
-- /attendance can line Sunday attendance up against the weather without
-- hitting the Open-Meteo archive API on every render. Location-global
-- (one church, one location) so there's no org_id — keyed by date in
-- America/New_York. Backfilled lazily from the historical archive for
-- the span of imported attendance weeks.
CREATE TABLE IF NOT EXISTS weather_daily (
  date TEXT PRIMARY KEY,           -- 'YYYY-MM-DD' local (America/New_York)
  tmax_f REAL,                     -- daily high °F
  tmin_f REAL,                     -- daily low °F
  precip_in REAL,                  -- total precipitation, inches
  fetched_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
