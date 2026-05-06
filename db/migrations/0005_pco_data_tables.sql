-- Tables that hold the data we pull from PCO.
-- Keyed by (org_id, pco_id) so we can support multiple orgs per server.
-- raw_json holds the full PCO record so future sync iterations can extract
-- additional fields without re-pulling.

CREATE TABLE IF NOT EXISTS pco_people (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  gender TEXT,
  birthdate TEXT,
  age INTEGER,
  address TEXT,
  membership_type TEXT,
  marital_status TEXT,
  status TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  inactivated_at TEXT,
  raw_json TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

CREATE INDEX IF NOT EXISTS pco_people_org_updated
  ON pco_people(org_id, pco_updated_at DESC);

CREATE TABLE IF NOT EXISTS pco_forms (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  active INTEGER,
  raw_json TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

CREATE TABLE IF NOT EXISTS pco_form_fields (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  pco_id TEXT NOT NULL,
  label TEXT,
  field_type TEXT,
  position INTEGER,
  required INTEGER,
  raw_json TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, form_id, pco_id)
);

CREATE TABLE IF NOT EXISTS pco_form_submissions (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  pco_id TEXT NOT NULL,
  person_id TEXT,
  verified INTEGER,
  requires_verification INTEGER,
  pco_created_at TEXT,
  raw_json TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, form_id, pco_id)
);

CREATE INDEX IF NOT EXISTS pco_form_subs_org_form
  ON pco_form_submissions(org_id, form_id, pco_created_at DESC);

-- Sync cursor: the latest pco_updated_at we've already pulled per resource.
-- Lets incremental syncs request only newer rows.
CREATE TABLE IF NOT EXISTS pco_sync_cursor (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  last_updated_at TEXT,
  last_synced_at TEXT,
  PRIMARY KEY (org_id, resource)
);

-- Add structured details to pco_sync_runs so we can show per-resource counts.
ALTER TABLE pco_sync_runs ADD COLUMN details TEXT;
