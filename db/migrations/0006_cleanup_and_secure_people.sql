-- Disable FK enforcement for the duration of this migration. The legacy
-- shepherdly tables reference each other and we don't care about FK order
-- when blowing them away. Re-enabled at the bottom.
PRAGMA foreign_keys = OFF;

-- 1) Drop the entire legacy schema left over from the previous Shepherdly
--    deploy. None of these tables are referenced by the current app.
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS attendance_records;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS check_in_reports;
DROP TABLE IF EXISTS churches;
DROP TABLE IF EXISTS department_members;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS group_applications;
DROP TABLE IF EXISTS group_event_attendances;
DROP TABLE IF EXISTS group_events;
DROP TABLE IF EXISTS group_memberships;
DROP TABLE IF EXISTS group_team_layer_mapping_items;
DROP TABLE IF EXISTS group_team_layer_mappings;
DROP TABLE IF EXISTS group_types;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS ministry_impact_reports;
DROP TABLE IF EXISTS pco_form_sync_config;
DROP TABLE IF EXISTS pco_list_layer_links;
DROP TABLE IF EXISTS pco_list_people;
DROP TABLE IF EXISTS pco_lists;
DROP TABLE IF EXISTS pco_signup_attendees;
DROP TABLE IF EXISTS pco_signups;
DROP TABLE IF EXISTS pco_sync_log;
DROP TABLE IF EXISTS pco_sync_resource_log;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS person_analytics;
DROP TABLE IF EXISTS plan_team_members;
DROP TABLE IF EXISTS planning_center_credentials;
DROP TABLE IF EXISTS service_plans;
DROP TABLE IF EXISTS service_types;
DROP TABLE IF EXISTS shepherd_over_rules;
DROP TABLE IF EXISTS shepherding_relationships;
DROP TABLE IF EXISTS survey_responses;
DROP TABLE IF EXISTS surveys;
DROP TABLE IF EXISTS team_memberships;
DROP TABLE IF EXISTS team_positions;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS tree_assignments;
DROP TABLE IF EXISTS tree_connections;
DROP TABLE IF EXISTS tree_layer_exclusions;
DROP TABLE IF EXISTS tree_layer_inclusions;
DROP TABLE IF EXISTS tree_layers;
DROP TABLE IF EXISTS tree_metric_bucket_layers;
DROP TABLE IF EXISTS tree_metric_buckets;
DROP TABLE IF EXISTS tree_oversight;

-- 2) Re-create pco_people with encrypted PII and no age/raw_json.
--    PII (first/last name, birthdate, address) lives encrypted in enc_pii
--    using the same AES-256-GCM key as the PCO credentials. Functional
--    columns (status, gender, membership_type, marital_status) stay
--    plaintext so we can filter and report on them efficiently.
--    last_activity_at is computed at sync time as the max of updated_at
--    and any form submission created_at, so the activity classification
--    (active/present/inactive) is one cheap lookup per row.
DROP TABLE IF EXISTS pco_people;
CREATE TABLE pco_people (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  enc_pii TEXT,
  gender TEXT,
  membership_type TEXT,
  marital_status TEXT,
  status TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  inactivated_at TEXT,
  last_activity_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_people_org_status ON pco_people(org_id, status);
CREATE INDEX IF NOT EXISTS pco_people_org_activity ON pco_people(org_id, last_activity_at);
CREATE INDEX IF NOT EXISTS pco_people_org_created ON pco_people(org_id, pco_created_at);

-- 3) Drop raw_json from form-related tables — same PII concern.
--    Keep enc_data on submissions (the actual form responses, encrypted).
DROP TABLE IF EXISTS pco_form_fields;
CREATE TABLE pco_form_fields (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  pco_id TEXT NOT NULL,
  label TEXT,
  field_type TEXT,
  position INTEGER,
  required INTEGER,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, form_id, pco_id)
);

DROP TABLE IF EXISTS pco_form_submissions;
CREATE TABLE pco_form_submissions (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  pco_id TEXT NOT NULL,
  person_id TEXT,
  verified INTEGER,
  requires_verification INTEGER,
  pco_created_at TEXT,
  enc_data TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, form_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_form_subs_org_form
  ON pco_form_submissions(org_id, form_id, pco_created_at DESC);
CREATE INDEX IF NOT EXISTS pco_form_subs_person
  ON pco_form_submissions(org_id, person_id);

DROP TABLE IF EXISTS pco_forms;
CREATE TABLE pco_forms (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  active INTEGER,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

-- 4) Activity threshold (default 18 months) + sync look-back threshold
--    (default 3 months). Both live in pco_sync_settings.
ALTER TABLE pco_sync_settings ADD COLUMN activity_months INTEGER NOT NULL DEFAULT 18;
ALTER TABLE pco_sync_settings ADD COLUMN sync_threshold_months INTEGER NOT NULL DEFAULT 3;

PRAGMA foreign_keys = ON;
