-- Secondary lapsed-from-team threshold. Default 3 events: a team needs
-- to have had at least N scheduled plans inside the lapsed window before
-- we'll mark any of its roster members as "lapsed." Prevents the false
-- positives of "they haven't served because nobody's been scheduled
-- lately" — keeps lapsed for people who really phased out / declined.
ALTER TABLE pco_sync_settings ADD COLUMN lapsed_from_team_events INTEGER NOT NULL DEFAULT 3;
