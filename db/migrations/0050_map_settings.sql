-- Map / campus-planning settings, kept separate from pco_sync_settings.
-- second_campus_max_hours: homes farther than this (driving, or estimated)
-- from Faith Church are excluded from the "ideal second campus"
-- calculations — they're likely out-of-area and shouldn't pull a campus
-- siting toward them. Default 3 hours.
CREATE TABLE IF NOT EXISTS map_settings (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  second_campus_max_hours REAL NOT NULL DEFAULT 3,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
