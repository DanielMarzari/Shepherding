-- Additional MIR team members beyond Lead + Sponsor — typically other
-- staff who contribute to the ministry the report describes. Plain
-- many-to-many; the doc's lead_person_id and sponsor_person_id are
-- filtered out at read time so they don't double-count.
CREATE TABLE IF NOT EXISTS mir_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mir_id INTEGER NOT NULL REFERENCES mir_docs(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  UNIQUE (org_id, mir_id, person_id)
);
CREATE INDEX IF NOT EXISTS mir_team_members_mir
  ON mir_team_members(org_id, mir_id);
