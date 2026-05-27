-- The "serving interest" form — set by an admin on /metrics. Drives
-- the serving pipeline: a submission of this form is what counts as a
-- person expressing interest in serving, so the pipeline only measures
-- conversion time from THIS form's submissions. People who start
-- serving without ever submitting it are tallied separately.
ALTER TABLE pco_sync_settings
  ADD COLUMN serving_interest_form_id TEXT;
