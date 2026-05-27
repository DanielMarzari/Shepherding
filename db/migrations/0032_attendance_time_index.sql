-- The "who's been active recently" pattern on /lanes scans
-- pco_event_attendances by (org_id, attended, event_starts_at). The
-- existing indexes are on (org_id, person_id) and (org_id, group_id),
-- which force a full-table scan + filter for the time-range query and
-- dominated /lanes load time. Add a covering index for the time scan.
CREATE INDEX IF NOT EXISTS pco_event_attendances_time
  ON pco_event_attendances(org_id, attended, event_starts_at);
