-- Geocoded member locations for the map page. Addresses live encrypted
-- in enc_pii; here we cache the resolved lat/lng so the map doesn't
-- re-geocode on every view. Coordinates are derived PII (where someone
-- lives) — same sensitivity as the address — and only ever sent to
-- authenticated org users.
--
-- person_geo: one row per person, with the HMAC of the address that was
-- geocoded so we can detect when an address changes and re-geocode.
-- status: 'ok' (has coords), 'nomatch' (geocoder couldn't place it),
-- 'noaddr' (no address on file) — the last two stop us retrying forever.
CREATE TABLE IF NOT EXISTS person_geo (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  addr_hash TEXT,
  lat REAL,
  lng REAL,
  status TEXT NOT NULL,
  geocoded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, person_id)
);

-- Shared cache keyed by the address HMAC (households share an address),
-- so we geocode each distinct address at most once. No plaintext address
-- is stored — only its keyed hash.
CREATE TABLE IF NOT EXISTS geocode_cache (
  addr_hash TEXT PRIMARY KEY,
  lat REAL,
  lng REAL,
  ok INTEGER NOT NULL,
  geocoded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
