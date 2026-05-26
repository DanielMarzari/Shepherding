-- Ministry Impact Reports — standard nonprofit logic-model documents
-- (Resources → Activities → Outputs → Outcomes → Impact) plus the
-- target audience and the team that authored each report. Hand-edited
-- for now; PCO data may fill more of it in later.
CREATE TABLE IF NOT EXISTS mir_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_audience TEXT,
  team TEXT,
  resources TEXT,
  activities TEXT,
  outputs TEXT,
  outcomes TEXT,
  impact TEXT,
  author_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS mir_docs_org_updated
  ON mir_docs(org_id, updated_at DESC);

-- Attendance data sources — references to outside spreadsheets / docs
-- (e.g. SharePoint Excel files) that hold historical attendance data
-- we may want to import later. Storing the link + a label so admins
-- can keep the bibliography in one place; the data itself stays in
-- those files until/unless we import it.
CREATE TABLE IF NOT EXISTS attendance_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS attendance_sources_org
  ON attendance_sources(org_id, created_at DESC);
