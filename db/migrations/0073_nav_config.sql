-- Per-org sidebar navigation configuration. One JSON document per org
-- describing the groups (headings), which pages sit in each, and whether a
-- group is top-level or a drill-in section. Absent row = the coded default
-- (src/lib/nav-registry.ts DEFAULT_NAV_CONFIG), so day-one behavior is
-- unchanged. Matches the JSON-blob-config style the builder already uses.
CREATE TABLE IF NOT EXISTS nav_config (
  org_id     INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  config     TEXT NOT NULL,   -- validated NavConfig JSON
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-user pinned pages (the "pin" affordance on See More + the nav). Keyed by
-- the nav-registry pageKey (or builder:<slug>) so it survives renames.
CREATE TABLE IF NOT EXISTS nav_pins (
  org_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL,
  page_key  TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, user_id, page_key)
);
CREATE INDEX IF NOT EXISTS nav_pins_user ON nav_pins(org_id, user_id, position);
