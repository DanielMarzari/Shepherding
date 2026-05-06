-- Excluded membership types: a JSON-array string of values to skip in
-- /people, /metrics, and counts. NULL means no exclusions.
-- Stored as text so we can keep the schema simple; parsed in app code.
ALTER TABLE pco_sync_settings ADD COLUMN excluded_membership_types TEXT;
