-- PCO's person_team_position_assignments has a `created_at` attribute
-- that records when an admin added the person to that team — the true
-- "added to the team" milestone. Before this we only had `synced_at`,
-- which reflects when WE synced the row, so historical "added" dates
-- were unusable for pipeline analysis.
--
-- After the migration, the next services sync will backfill this for
-- every team membership PCO surfaces. Rows that PCO no longer returns
-- (e.g. deleted assignments) stay NULL.
ALTER TABLE pco_team_memberships ADD COLUMN pco_created_at TEXT;
CREATE INDEX IF NOT EXISTS pco_team_memberships_created_at
  ON pco_team_memberships(org_id, pco_created_at);
