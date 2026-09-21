-- Record what source data each dashboard refresh was built from.
--
-- Every dashboard, map, intake form and graph reads the snapshot tables
-- (person_activity and friends), not pco_*. On 2026-09-16 production served
-- eleven-day-old snapshots because syncs kept dying and the rebuild only ran
-- on success. Nothing could tell: dashboard_refresh_runs was written by the
-- Refresh button alone, and its newest row was from 2026-06-02.
--
-- source_synced_through is MAX(pco_people.synced_at) read at the START of a
-- refresh; the snapshots are stale when pco_people holds a newer synced_at.
-- triggered_by says which path ran it (manual / sync / sync-error /
-- self-heal). Old rows stay NULL — their source was never recorded, and
-- guessing one would be a fake watermark — so freshness reads "unknown" until
-- the first refresh after this deploy.
--
-- One transaction: ADD COLUMN has no IF NOT EXISTS, so a half-applied run
-- would fail on the first ALTER forever after. Deploys apply this while the
-- old code is still serving; its INSERTs name their columns, so the new ones
-- just stay NULL on its rows.
BEGIN;

ALTER TABLE dashboard_refresh_runs ADD COLUMN source_synced_through TEXT;
ALTER TABLE dashboard_refresh_runs ADD COLUMN triggered_by TEXT;

-- The staleness check runs on every home render and every 15-minute cron
-- tick. Without this index MAX(synced_at) scanned pco_people through
-- pco_people_birth_year: 6.5 ms warm, 83 ms cold, on a production copy. With
-- it the MAX is one seek to the end of the index: 0.004 ms. 14 ms to build;
-- the nightly sync re-upserts ~2k people, so the upkeep is negligible.
CREATE INDEX IF NOT EXISTS pco_people_org_synced
  ON pco_people(org_id, synced_at);

-- Give the new index statistics now rather than on the next connection open
-- (optimize=0x10002 would do it there). Full, not sampled: see 0088 for why a
-- sample misleads the planner on org_id-leading indexes.
PRAGMA analysis_limit = 0;
ANALYZE pco_people;

COMMIT;
