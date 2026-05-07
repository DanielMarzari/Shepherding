-- PCO Services / Teams data
CREATE TABLE IF NOT EXISTS pco_service_types (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  archived_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);

CREATE TABLE IF NOT EXISTS pco_teams (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  name TEXT,
  service_type_id TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  archived_at TEXT,
  deleted_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_teams_org_service ON pco_teams(org_id, service_type_id);

CREATE TABLE IF NOT EXISTS pco_team_positions (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  team_id TEXT,
  name TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_team_positions_team ON pco_team_positions(org_id, team_id);

-- Standing roster: who's assigned to which team in which position. Filled from
-- /services/v2/teams/{id}/person_team_position_assignments. Replace-per-team
-- on each sync so dropped assignments actually disappear.
CREATE TABLE IF NOT EXISTS pco_team_memberships (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  position_id TEXT,
  position_name TEXT,
  is_team_leader INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_team_memberships_person ON pco_team_memberships(org_id, person_id);
CREATE INDEX IF NOT EXISTS pco_team_memberships_team ON pco_team_memberships(org_id, team_id);

-- Service plans (one per Sunday or service event)
CREATE TABLE IF NOT EXISTS pco_plans (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  service_type_id TEXT,
  title TEXT,
  sort_date TEXT,
  pco_created_at TEXT,
  pco_updated_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_plans_org_date ON pco_plans(org_id, sort_date DESC);

-- Per-plan-per-person serving record (the "did you serve that Sunday" trace)
CREATE TABLE IF NOT EXISTS pco_plan_people (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pco_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  team_id TEXT,
  team_position_name TEXT,
  status TEXT,
  pco_created_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, pco_id)
);
CREATE INDEX IF NOT EXISTS pco_plan_people_person ON pco_plan_people(org_id, person_id);
CREATE INDEX IF NOT EXISTS pco_plan_people_team   ON pco_plan_people(org_id, team_id);
CREATE INDEX IF NOT EXISTS pco_plan_people_plan   ON pco_plan_people(org_id, plan_id);

-- Filters + threshold
ALTER TABLE pco_sync_settings ADD COLUMN excluded_team_types TEXT;
ALTER TABLE pco_sync_settings ADD COLUMN lapsed_from_team_weeks INTEGER NOT NULL DEFAULT 10;

-- Cached "last served on this team" timestamp per assignment, computed
-- post-sync from pco_plan_people joined with pco_plans.
ALTER TABLE pco_team_memberships ADD COLUMN last_served_at TEXT;
