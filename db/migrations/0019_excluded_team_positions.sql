-- Exclusion list for specific team positions. Lets admins say "the
-- Worship team counts toward Serve, but the 'Sound Booth Trainee'
-- position on it doesn't." Stored as JSON array of pco_team_positions
-- pco_ids, same shape as the other excluded_* columns.
ALTER TABLE pco_sync_settings ADD COLUMN excluded_team_positions TEXT;
