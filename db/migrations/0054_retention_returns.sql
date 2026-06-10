-- Precomputed retention "returns": people who went quiet for longer than the
-- activity window and then came back, counted by the calendar year they
-- returned. The source scan walks ~330k dated activity rows (check-ins, plan
-- serving, event attendance) and is far too heavy for a live request — it was
-- 502-ing /retention — so it is recomputed nightly during the dashboard
-- refresh and the page just reads these few rows. One row per (org, year).
CREATE TABLE IF NOT EXISTS retention_returns (
  org_id      INTEGER NOT NULL,
  year        INTEGER NOT NULL,
  count       INTEGER NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, year)
);

-- Make the nightly returns scan tractable: reading each person's dated
-- activity already grouped by person and ordered by time lets the window
-- function run without a full sort of the 266k check-in rows.
CREATE INDEX IF NOT EXISTS pco_check_ins_person_time
  ON pco_check_ins(org_id, person_id, event_time_at);
CREATE INDEX IF NOT EXISTS pco_event_att_person_time
  ON pco_event_attendances(org_id, person_id, event_starts_at);
