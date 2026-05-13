-- Switch the "lapsed-from-team" threshold from weeks to months. 6 months
-- of not serving is the new default; matches how pastors think about
-- serving cadence (monthly, not weekly).
ALTER TABLE pco_sync_settings ADD COLUMN lapsed_from_team_months INTEGER NOT NULL DEFAULT 6;

-- Best-effort migration of any existing value: ~4.33 weeks per month,
-- floor to at least 1. Old default (10wk) becomes 2mo; if the user had
-- never touched it, just use the new default of 6.
UPDATE pco_sync_settings
   SET lapsed_from_team_months = CASE
     WHEN lapsed_from_team_weeks IS NULL OR lapsed_from_team_weeks = 0 THEN 6
     WHEN lapsed_from_team_weeks = 10 THEN 6  -- old default → new default
     ELSE MAX(1, CAST(ROUND(lapsed_from_team_weeks / 4.33) AS INTEGER))
   END;
