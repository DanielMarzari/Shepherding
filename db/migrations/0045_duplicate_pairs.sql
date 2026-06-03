-- Materialized duplicate-candidate PAIRS so /audit/duplicates doesn't
-- decrypt and re-match the whole people table on every page load. Built
-- after each sync (and lazily on first view). Each row is a pair of
-- people who share a suffix-stripped name, with a score, confidence, and
-- the human reasons (matching email / birthdate / address / suffix) that
-- explain WHY we think they're the same person — or a household pair.
-- Inactive↔inactive pairs are intentionally NOT stored: we only care
-- about active↔active (true dupes) and active↔inactive (someone who may
-- be coming back). No plaintext names are stored — the read layer
-- decrypts just the people that appear in a pair.
CREATE TABLE IF NOT EXISTS duplicate_pairs (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_a TEXT NOT NULL,
  person_b TEXT NOT NULL,
  name_key TEXT NOT NULL,
  confidence TEXT NOT NULL,            -- 'high' | 'low'
  score INTEGER NOT NULL,
  reasons TEXT NOT NULL,               -- JSON array of strings
  one_active_one_inactive INTEGER NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, person_a, person_b)
);
CREATE INDEX IF NOT EXISTS duplicate_pairs_org_conf
  ON duplicate_pairs(org_id, confidence);

-- "Has this org's duplicate scan ever run?" — so an org with genuinely
-- zero duplicates (empty pairs table) isn't rebuilt on every page load.
CREATE TABLE IF NOT EXISTS duplicate_pairs_meta (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  built_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
