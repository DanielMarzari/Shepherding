-- Per-person first/last real-engagement month (month-index = year*12 + (month-1)),
-- across the dated activity sources (check-ins, plan serving, event attendance).
-- Used to re-base the retention decay on the year a person FIRST actually
-- engaged — not the year their PCO profile was created — so someone who sat in
-- the system for years and only engaged later starts (and decays) from that
-- later year, and people who never engaged don't appear at all.
--
-- Computed nightly by the same heavy child-process scan as retention_returns
-- (far too slow for a live request); the page just reads these rows.
CREATE TABLE IF NOT EXISTS retention_engagement (
  org_id    INTEGER NOT NULL,
  person_id TEXT NOT NULL,
  first_mi  INTEGER NOT NULL,
  last_mi   INTEGER NOT NULL,
  PRIMARY KEY (org_id, person_id)
);
