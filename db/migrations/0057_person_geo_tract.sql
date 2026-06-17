-- Cache each geocoded home's census tract + county so the Reaching-the-Valley
-- and Next-campus-planner pages don't re-run point-in-polygon for ~25k homes
-- against ~200 tracts (and 7 counties) on every request. Assignment depends
-- only on lat/lng (static boundaries), so it's computed once per home and
-- recomputed only when the home is re-geocoded (geocoded_at > geo_assigned_at).
ALTER TABLE person_geo ADD COLUMN tract_geoid TEXT;
ALTER TABLE person_geo ADD COLUMN county_geoid TEXT;
ALTER TABLE person_geo ADD COLUMN geo_assigned_at TEXT;

CREATE INDEX IF NOT EXISTS person_geo_tract ON person_geo(org_id, tract_geoid);
CREATE INDEX IF NOT EXISTS person_geo_county ON person_geo(org_id, county_geoid);
