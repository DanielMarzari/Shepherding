-- PCO Check-Ins EVENT PERIODS: one row per event per date, with the counts PCO
-- itself totals for that day.
--
-- Headcounts (0101) cover the worship venues and the online channels, because
-- that is where a volunteer types a number in. Kids and students are not
-- counted that way — they are counted by children actually checking in — and
-- PCO already totals each day on the event period: regular_count, guest_count,
-- volunteer_count. That is a better source than counting pco_check_ins rows,
-- because it is PCO's own figure rather than our reconstruction of it.
--
-- WHAT EACH ONE IS WORTH, measured against the spreadsheet before this shipped:
--
--   Sunday AM Kids  ->  kids_total.  Median difference 0, 80% of weeks within
--   5, 92% within 10, worst miss 20 across 71 weeks. The same measurement,
--   differing only by late check-ins. Safe to fill.
--
--   Sunday AM + Afternoon + PM Students  ->  student_total.  Median -8, but
--   only 30% of weeks within 5 and misses of -89 and +68. The errors run BOTH
--   directions, so it is not a leader offset — it is that student check-in
--   coverage collapses some weeks (2025-02-02 has PCO at 2 against a sheet
--   figure of 91). The composition is right, confirmed by the ministry lead;
--   the coverage is not reliable. So student_total is filled only where the
--   sheet has nothing AND the week does not look like a dropout, and the page
--   records that it came from PCO.
--
-- The unique_* counts PCO documents on this vertex (unique_total_count and
-- friends) are NOT populated for these events — every one came back empty — so
-- regular + guest + volunteer is what there is.
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS pco_event_periods (
  org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id           TEXT NOT NULL,
  event_id         TEXT,
  event_name       TEXT,
  starts_at        TEXT,
  ends_at          TEXT,
  local_date       TEXT,   -- America/New_York, 'YYYY-MM-DD'
  regular_count    INTEGER,
  guest_count      INTEGER,
  volunteer_count  INTEGER,
  note             TEXT,
  pco_created_at   TEXT,
  pco_updated_at   TEXT,
  synced_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_event_periods_date
  ON pco_event_periods(org_id, local_date);
CREATE INDEX IF NOT EXISTS pco_event_periods_event
  ON pco_event_periods(org_id, event_name, local_date);

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0102_pco_event_periods.sql');
COMMIT;
