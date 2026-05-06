-- Weekly needs day-of-week, monthly needs day-of-month.
-- Plus minute-of-hour for completeness on hourly+ frequencies.

ALTER TABLE pco_sync_settings ADD COLUMN run_at_dow INTEGER NOT NULL DEFAULT 0
  CHECK (run_at_dow BETWEEN 0 AND 6);

ALTER TABLE pco_sync_settings ADD COLUMN run_at_dom INTEGER NOT NULL DEFAULT 1
  CHECK (run_at_dom BETWEEN 1 AND 28);

-- Per-entity sync toggles (bring back "What to sync" table). Seed defaults
-- happen in code on first page load, not here, so this stays empty until used.
-- (Table itself was created in 0001/0003.)
