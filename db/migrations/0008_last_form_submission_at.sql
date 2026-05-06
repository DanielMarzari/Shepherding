-- Track each person's most recent form submission timestamp so we can
-- classify "Active" without joining pco_form_submissions on every read.
-- Recomputed at the end of every sync.
ALTER TABLE pco_people ADD COLUMN last_form_submission_at TEXT;
CREATE INDEX IF NOT EXISTS pco_people_org_lastform
  ON pco_people(org_id, last_form_submission_at);
