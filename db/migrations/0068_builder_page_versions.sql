-- Edit history for builder pages, powering Undo. Each row is a full snapshot of
-- a page (meta + all blocks) captured just before a change. Only the most recent
-- few per page are kept (pruned in code).
CREATE TABLE IF NOT EXISTS builder_page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES builder_pages(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL,
  snapshot TEXT NOT NULL, -- JSON { page: {...}, blocks: [{id,position,kind,config}] }
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS builder_page_versions_page ON builder_page_versions(page_id, id);
