-- Composite indexes for the /people/[slug] profile sections. The
-- group-attendance and team-serving cards filter on the full
-- (org_id, person_id, <unit_id>) triple but the existing indexes only
-- cover (org_id, person_id) or (org_id, <unit_id>) separately — so
-- SQLite picks one and filters the rest per row. These composites let
-- the per-person aggregations be fully index-covered.

-- Group attendance: COUNT/MIN/MAX of a person's attendance per group.
-- Including attended + event_starts_at makes it a covering index for
-- the rollup (no table lookup needed).
CREATE INDEX IF NOT EXISTS pco_event_attendances_person_group
  ON pco_event_attendances(org_id, person_id, group_id, attended, event_starts_at);

-- Team serving: per-person plan_people rolled up by team. team_id in
-- the index avoids scanning all of a person's plan rows when only one
-- team's matter.
CREATE INDEX IF NOT EXISTS pco_plan_people_person_team
  ON pco_plan_people(org_id, person_id, team_id, plan_id);
