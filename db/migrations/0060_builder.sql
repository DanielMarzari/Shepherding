-- Page Builder: admin-composed custom pages made of data blocks. Each block
-- carries a kind (stat / table / bar / text) and a JSON config that includes a
-- read-only SQL query the block renders. Queries run against a READ-ONLY
-- connection (see lib/builder.ts), so blocks can surface any data without any
-- risk of writes.
CREATE TABLE IF NOT EXISTS builder_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS builder_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES builder_pages(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,   -- 'stat' | 'table' | 'bar' | 'text'
  config TEXT NOT NULL, -- JSON: { title, sql, sub, text, span, ... }
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS builder_blocks_page ON builder_blocks(page_id, position);
