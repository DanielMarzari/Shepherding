-- Per-org SQL-editor color theme (Settings › Appearance). Stores the chosen
-- role→color mapping + toggles as JSON; the (app) layout injects it as
-- --sql-* CSS variable overrides. Absent row = the built-in default
-- (blue keyword · pink table · yellow field · green function).
CREATE TABLE IF NOT EXISTS builder_theme (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  theme_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
