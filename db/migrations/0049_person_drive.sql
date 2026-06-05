-- Cached driving distance/time from Faith Church to each geocoded home,
-- computed once by a local OSRM instance (Pennsylvania OSM extract) via
-- its batched `table` service. We store ONLY distance + duration (two
-- numbers) — not the full route geometry — so storage stays tiny; routes
-- are recomputed only when a home's coordinates change. status: 'ok',
-- 'fail' (router couldn't route it), 'noloc' (no geocode).
CREATE TABLE IF NOT EXISTS person_drive (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  lat REAL,                 -- the home coords this drive was computed for
  lng REAL,
  miles REAL,
  minutes REAL,
  status TEXT NOT NULL,
  computed_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, person_id)
);
