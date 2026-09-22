-- Every org-scoped table declares its org_id as a key to organizations.
--
-- 77 tables declare org_id INTEGER NOT NULL REFERENCES organizations(id)
-- ON DELETE CASCADE. These 15 have the same column without the REFERENCES:
--
--   attendance_service (0056)       cc_contacts (0062)
--   builder_blocks (0060)           cc_lists (0062)
--   builder_page_versions (0068)    cc_sync_cursor (0062)
--   cc_campaign_lists (0062)        cc_sync_runs (0062)
--   cc_campaigns (0062)             pco_plan_items (0077)
--   cc_contact_activity (0062)      retention_engagement (0055)
--   cc_contact_lists (0062)         retention_returns (0054)
--                                   sermons (0076)
--
-- With the key, a row whose org_id names no organization cannot be written
-- (the app runs with foreign keys on), and deleting an organization removes
-- these rows like every sibling's instead of leaving them behind. Nothing
-- deletes organizations today.
--
-- Only that clause changes. Each new definition is the old text, character
-- for character, with " REFERENCES organizations(id) ON DELETE CASCADE" after
-- org_id's type; the schema check below proves it before any row moves. Every
-- column, default, CHECK, primary key, UNIQUE and index is as it was, and so
-- is every row and its rowid. The rowid matters for cc_contact_activity: the
-- Constant Contact rollups use MAX(cc_contact_activity.rowid) as their change
-- watermark (isCcEngagementStale in src/lib/constant-contact-sync.ts), and
-- renumbered rowids would make it misjudge whether the rollups are current.
-- builder_blocks and builder_page_versions keep their page_id key to
-- builder_pages. After the rename sqlite_master spells each name quoted,
-- CREATE TABLE "cc_contacts": that is how RENAME writes it, and it is the same
-- table.
--
-- Two tables have a second possible definition. In production, pco_plan_items
-- and sermons were first created by scripts/backfill-plan-items.mjs and
-- scripts/import-sermons.mjs, before 0077 and 0076 ran (both CREATE TABLE IF
-- NOT EXISTS), so production holds the scripts' one-line text, while a
-- database built by the migrations holds 0077's and 0076's commented text.
-- Columns, types, defaults, keys and indexes are identical (compared with
-- pragma table_info / index_list). The schema check accepts either, and the
-- rebuilt table always gets production's text plus the clause, so on a
-- migration-built database those two lose their column comments; the comments
-- stay in 0076 and 0077.
--
-- On the 2026-09-21 production copy (after 0093) every one of these rows has
-- org_id 1, which exists, and PRAGMA foreign_key_check is empty afterwards.
-- Rows carried over: attendance_service 2,418, builder_blocks 507,
-- builder_page_versions 27, cc_campaign_lists 288, cc_campaigns 4,928,
-- cc_contact_activity 234,314, cc_contact_lists 23,678, cc_contacts 18,044,
-- cc_lists 72, cc_sync_cursor 1, cc_sync_runs 10, pco_plan_items 18,651,
-- retention_engagement 10,988, retention_returns 11, sermons 429.
--
-- How: the same documented rebuild as 0094 (foreign keys off outside the
-- transaction; create under a temporary name; copy with explicit column lists
-- and rowids; drop; rename; recreate indexes; restore the AUTOINCREMENT
-- counters and planner statistics; check; commit; foreign keys on), with the
-- same guard: a TEMP table and triggers that RAISE(ROLLBACK) with a message
-- naming the failed check, so a refusal changes nothing. The checks: schema
-- (above), copy (old and new identical, rowid included, before the old table
-- is dropped), keys (exactly one org key per table, as declared, and
-- foreign_key_check empty), indexes, counters, stats, quick_check.
--
-- Cost. The file rewrites ~105 MB of table and index pages, 77 MB of it
-- cc_contact_activity. On the production copy it took 2.6 to 4.5 s across
-- three runs on a heavily loaded laptop (the 2-vCPU host is untimed), all of
-- it with the write lock held; the copy, the index builds, the copy check and
-- COMMIT's fsync are ~0.5 s each. Readers are unaffected (WAL). The old code's
-- writes in that window wait, up to its 10 s busy_timeout.
--
-- Recording. The file records itself in _migrations just before COMMIT, and
-- the runners' own insert afterwards is INSERT OR IGNORE. That insert needs
-- the write lock again, and app writers queued behind this file take it first
-- (COMMIT's checkpoint of ~100 MB of WAL leaves a wide gap). Before this, a
-- writer holding the lock past the runner's 5 s timeout left 0095 applied but
-- unrecorded; re-running it refused, which failed every later deploy and every
-- boot of the new build (reproduced on the production copy with one 6 s
-- writer). The deploy runner now waits up to 60 s for the lock. A "database is
-- locked" at BEGIN IMMEDIATE means nothing has changed; one after COMMIT means
-- 0095 is applied and recorded, and a re-run skips it (reproduced with a 12 s
-- writer: the runner failed, _migrations held 0095, the re-run was a no-op; in
-- the app, getDb() threw once and the next call opened normally).
--
-- Either way re-run the deploy at once, before anything restarts the app.
-- deploy.yml copies the new build and this file to the host before the migrate
-- step, so a restart boots the new build, and getDb() applies pending
-- migrations inside the app process. There 0094+0095 add ~80 MB to peak RSS
-- (a bare node process with the app's pragmas: 46 MB open, 122-128 MB peak,
-- on the production copy) and block the event loop for 2-5 s, in a process pm2
-- restarts at 150 MB. A kill mid-file rolls the transaction back and the next
-- boot retries it, so nothing is lost, but the site can restart until one
-- attempt gets through.
--
-- The database file grows by ~78 MB: the old pages go on the freelist (21k
-- pages, 82 MB) and are reused by later writes, and the WAL grows by about the
-- same until the next checkpoint. Afterwards each insert into these tables
-- also looks up organizations (one row), which is not measurable.
PRAGMA foreign_keys = OFF;

-- IMMEDIATE, as in 0092: the guard's snapshot reads come before any write.
BEGIN IMMEDIATE;

CREATE TEMP TABLE _0095_guard (step TEXT NOT NULL);

-- What must survive the rebuild unchanged.
CREATE TEMP TABLE _0095_tables AS
  SELECT name, sql FROM sqlite_master
   WHERE type = 'table'
     AND name IN ('attendance_service', 'builder_blocks', 'builder_page_versions', 'cc_campaign_lists', 'cc_campaigns', 'cc_contact_activity', 'cc_contact_lists', 'cc_contacts', 'cc_lists', 'cc_sync_cursor', 'cc_sync_runs', 'pco_plan_items', 'retention_engagement', 'retention_returns', 'sermons');
CREATE TEMP TABLE _0095_indexes AS
  SELECT name, tbl_name, sql FROM sqlite_master
   WHERE type = 'index' AND tbl_name IN (SELECT name FROM _0095_tables);
CREATE TEMP TABLE _0095_seq AS
  SELECT name, seq FROM sqlite_sequence WHERE name IN (SELECT name FROM _0095_tables);
CREATE TEMP TABLE _0095_stat1 AS
  SELECT * FROM sqlite_stat1 WHERE tbl IN (SELECT name FROM _0095_tables);
CREATE TEMP TABLE _0095_stat4 AS
  SELECT * FROM sqlite_stat4 WHERE tbl IN (SELECT name FROM _0095_tables);

-- The other definition two of these tables can have (see the header): the
-- text 0077 and 0076 create, as the migration chain leaves it.
CREATE TEMP TABLE _0095_variants (name TEXT NOT NULL, sql TEXT NOT NULL);
INSERT INTO _0095_variants (name, sql) VALUES
  ('pco_plan_items', 'CREATE TABLE pco_plan_items (
  org_id          INTEGER NOT NULL,
  pco_id          TEXT    NOT NULL,   -- PCO Item id
  plan_id         TEXT    NOT NULL,   -- PCO Plan id (→ pco_plans.pco_id)
  service_type_id TEXT,
  sequence        INTEGER,            -- order within the service
  item_type       TEXT,              -- ''header'' | ''song'' | ''item'' | ''media''
  title           TEXT,
  description      TEXT,
  html_details     TEXT,
  length           INTEGER,           -- seconds
  synced_at        TEXT NOT NULL DEFAULT (strftime(''%Y-%m-%dT%H:%M:%fZ'',''now'')),
  PRIMARY KEY (org_id, pco_id)
)'),
  ('sermons', 'CREATE TABLE sermons (
  org_id        INTEGER NOT NULL,
  source_id     INTEGER NOT NULL,   -- Sermon Lab sources.id
  preached_on   TEXT    NOT NULL,   -- ''YYYY-MM-DD'', snapped to the sermon''s Sunday
  title         TEXT,
  scripture     TEXT,
  speaker       TEXT,
  word_count    INTEGER,            -- transcript length (sanity / coverage)
  -- --- classification (NULL until classified) ---
  topic         TEXT,               -- short primary theme, e.g. "Generosity"
  summary       TEXT,               -- 1-2 sentence plain summary
  -- next_steps: JSON object keyed by the canonical categories in
  -- sermon-impact.ts. Each value: {called:bool, intensity:0..3, quote:string}.
  -- intensity 0 = mentioned in passing, 3 = explicit repeated call to act.
  next_steps    TEXT,
  themes        TEXT,               -- JSON array of free-form theme tags
  confidence    REAL,               -- 0..1 classifier self-confidence
  classifier    TEXT,               -- model / prompt version that produced this
  classified_at TEXT, transcript TEXT,
  PRIMARY KEY (org_id, source_id)
)');

-- Refuse unless each table is still exactly the definition below minus the
-- one REFERENCES clause, and nothing else names it (no view, no trigger, no
-- other table's foreign key): the rebuild procedure is only safe then.
CREATE TEMP TRIGGER _0095_check_schema BEFORE INSERT ON _0095_guard
WHEN NEW.step = 'schema' AND (
  (SELECT COUNT(*) FROM _0095_tables) <> 15
  OR EXISTS (SELECT 1 FROM sqlite_master WHERE type IN ('view', 'trigger'))
  OR EXISTS (SELECT 1 FROM sqlite_master m, pragma_foreign_key_list(m.name) f
              WHERE m.type = 'table' AND f."table" IN (SELECT name FROM _0095_tables))
  OR EXISTS (
    SELECT 1 FROM _0095_tables t, (SELECT ' REFERENCES organizations(id) ON DELETE CASCADE' AS clause) c,
           (SELECT name, sql FROM sqlite_master WHERE type = 'table') n
     WHERE n.name = '_0095_' || t.name
       AND (instr(t.sql, c.clause) <> 0
            OR length(n.sql) - length(replace(n.sql, c.clause, '')) <> length(c.clause)
            OR (replace(replace(n.sql, 'CREATE TABLE _0095_' || t.name, 'CREATE TABLE ' || t.name),
                        c.clause, '') IS NOT t.sql
                AND t.sql NOT IN (SELECT sql FROM _0095_variants v WHERE v.name = t.name))))
  OR (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name GLOB '_0095_*') <> 15)
BEGIN
  SELECT RAISE(ROLLBACK, '0095 refused (schema): one of the 15 tables is no longer the table this migration was written against, or a view, trigger or foreign key now names one. Regenerate 0095 from the current definitions. Nothing was changed.');
END;

-- The new tables: each production definition, character for character, plus
-- REFERENCES organizations(id) ON DELETE CASCADE on org_id.

CREATE TABLE _0095_attendance_service (
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sunday_on   TEXT NOT NULL,
  room        TEXT NOT NULL,  -- 'center' | 'chapel' | 'kids' | 'student'
  service     TEXT NOT NULL,  -- service start time, e.g. '8:00', '9:30', '11:15'
  count       INTEGER,
  source_file TEXT,
  PRIMARY KEY (org_id, sunday_on, room, service)
);

CREATE TABLE _0095_builder_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES builder_pages(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,   -- 'stat' | 'table' | 'bar' | 'text'
  config TEXT NOT NULL, -- JSON: { title, sql, sub, text, span, ... }
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE _0095_builder_page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES builder_pages(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL, -- JSON { page: {...}, blocks: [{id,position,kind,config}] }
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE _0095_cc_campaign_lists (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_activity_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (org_id, campaign_activity_id, list_id)
);

CREATE TABLE _0095_cc_campaigns (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_activity_id TEXT,  -- primary_email activity id (stats + tracking key)
  name TEXT,
  current_status TEXT,
  type TEXT,
  created_at TEXT,
  updated_at TEXT,
  activity_synced_at TEXT,    -- when we last pulled per-contact tracking
  synced_at TEXT, last_sent_at TEXT, stat_sends INTEGER, stat_opens INTEGER, stat_clicks INTEGER, stat_bounces INTEGER, stat_optouts INTEGER, stat_forwards INTEGER, stat_abuse INTEGER, stat_not_opened INTEGER, stats_updated_at TEXT,
  PRIMARY KEY (org_id, campaign_id)
);

CREATE TABLE _0095_cc_contact_activity (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_activity_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,   -- open / click / bounce / optout / send / forward
  occurred_at TEXT,
  link_url TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (org_id, campaign_activity_id, contact_id, activity_type, link_url)
);

CREATE TABLE _0095_cc_contact_lists (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (org_id, contact_id, list_id)
);

CREATE TABLE _0095_cc_contacts (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  email_hash TEXT,            -- HMAC of the lowercased email (join key to PCO)
  person_id TEXT,            -- resolved pco_people.pco_id, if matched
  permission_to_send TEXT,   -- explicit / implicit / pending / unsubscribed / …
  opt_in_source TEXT,
  opted_in_at TEXT,
  opted_out_at TEXT,
  create_source TEXT,
  created_at TEXT,
  updated_at TEXT,
  synced_at TEXT,
  PRIMARY KEY (org_id, contact_id)
);

CREATE TABLE _0095_cc_lists (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL,
  name TEXT,
  membership_count INTEGER,
  favorite INTEGER,
  created_at TEXT,
  updated_at TEXT,
  synced_at TEXT,
  PRIMARY KEY (org_id, list_id)
);

CREATE TABLE _0095_cc_sync_cursor (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  last_updated_at TEXT,
  last_synced_at TEXT,
  PRIMARY KEY (org_id, resource)
);

CREATE TABLE _0095_cc_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT,
  status TEXT,
  full_refresh INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  error TEXT
);

CREATE TABLE _0095_pco_plan_items (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, pco_id TEXT NOT NULL, plan_id TEXT NOT NULL, service_type_id TEXT,
  sequence INTEGER, item_type TEXT, title TEXT, description TEXT, html_details TEXT, length INTEGER,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (org_id, pco_id));

CREATE TABLE _0095_retention_engagement (
  org_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  first_mi  INTEGER NOT NULL,
  last_mi   INTEGER NOT NULL,
  PRIMARY KEY (org_id, person_id)
);

CREATE TABLE _0095_retention_returns (
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  count       INTEGER NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, year)
);

CREATE TABLE _0095_sermons (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, source_id INTEGER NOT NULL, preached_on TEXT NOT NULL,
  title TEXT, scripture TEXT, speaker TEXT, word_count INTEGER,
  topic TEXT, summary TEXT, next_steps TEXT, themes TEXT, confidence REAL,
  classifier TEXT, classified_at TEXT, transcript TEXT, PRIMARY KEY (org_id, source_id));

-- Before any data moves.
INSERT INTO _0095_guard (step) VALUES ('schema');
DROP TRIGGER _0095_check_schema;

-- Every row, with its rowid (the id column, where the table has one).
-- cc_contact_activity's rowid is the Constant Contact rollups' change
-- watermark (isCcEngagementStale compares MAX(rowid) with
-- cc_engagement_snapshot.activity_watermark_rowid), so it must not move.
INSERT INTO _0095_attendance_service (rowid, org_id, sunday_on, room, service, count, source_file)
  SELECT rowid, org_id, sunday_on, room, service, count, source_file FROM attendance_service;
INSERT INTO _0095_builder_blocks (id, page_id, org_id, position, kind, config, created_at, updated_at)
  SELECT id, page_id, org_id, position, kind, config, created_at, updated_at FROM builder_blocks;
INSERT INTO _0095_builder_page_versions (id, page_id, org_id, snapshot, created_at)
  SELECT id, page_id, org_id, snapshot, created_at FROM builder_page_versions;
INSERT INTO _0095_cc_campaign_lists (rowid, org_id, campaign_activity_id, list_id)
  SELECT rowid, org_id, campaign_activity_id, list_id FROM cc_campaign_lists;
INSERT INTO _0095_cc_campaigns (rowid, org_id, campaign_id, campaign_activity_id, name, current_status, type, created_at, updated_at, activity_synced_at, synced_at, last_sent_at, stat_sends, stat_opens, stat_clicks, stat_bounces, stat_optouts, stat_forwards, stat_abuse, stat_not_opened, stats_updated_at)
  SELECT rowid, org_id, campaign_id, campaign_activity_id, name, current_status, type, created_at, updated_at, activity_synced_at, synced_at, last_sent_at, stat_sends, stat_opens, stat_clicks, stat_bounces, stat_optouts, stat_forwards, stat_abuse, stat_not_opened, stats_updated_at FROM cc_campaigns;
INSERT INTO _0095_cc_contact_activity (rowid, org_id, campaign_activity_id, contact_id, activity_type, occurred_at, link_url)
  SELECT rowid, org_id, campaign_activity_id, contact_id, activity_type, occurred_at, link_url FROM cc_contact_activity;
INSERT INTO _0095_cc_contact_lists (rowid, org_id, contact_id, list_id)
  SELECT rowid, org_id, contact_id, list_id FROM cc_contact_lists;
INSERT INTO _0095_cc_contacts (rowid, org_id, contact_id, email_hash, person_id, permission_to_send, opt_in_source, opted_in_at, opted_out_at, create_source, created_at, updated_at, synced_at)
  SELECT rowid, org_id, contact_id, email_hash, person_id, permission_to_send, opt_in_source, opted_in_at, opted_out_at, create_source, created_at, updated_at, synced_at FROM cc_contacts;
INSERT INTO _0095_cc_lists (rowid, org_id, list_id, name, membership_count, favorite, created_at, updated_at, synced_at)
  SELECT rowid, org_id, list_id, name, membership_count, favorite, created_at, updated_at, synced_at FROM cc_lists;
INSERT INTO _0095_cc_sync_cursor (rowid, org_id, resource, last_updated_at, last_synced_at)
  SELECT rowid, org_id, resource, last_updated_at, last_synced_at FROM cc_sync_cursor;
INSERT INTO _0095_cc_sync_runs (id, org_id, started_at, finished_at, trigger, status, full_refresh, requests, details, error)
  SELECT id, org_id, started_at, finished_at, trigger, status, full_refresh, requests, details, error FROM cc_sync_runs;
INSERT INTO _0095_pco_plan_items (rowid, org_id, pco_id, plan_id, service_type_id, sequence, item_type, title, description, html_details, length, synced_at)
  SELECT rowid, org_id, pco_id, plan_id, service_type_id, sequence, item_type, title, description, html_details, length, synced_at FROM pco_plan_items;
INSERT INTO _0095_retention_engagement (rowid, org_id, person_id, first_mi, last_mi)
  SELECT rowid, org_id, person_id, first_mi, last_mi FROM retention_engagement;
INSERT INTO _0095_retention_returns (rowid, org_id, year, count, computed_at)
  SELECT rowid, org_id, year, count, computed_at FROM retention_returns;
INSERT INTO _0095_sermons (rowid, org_id, source_id, preached_on, title, scripture, speaker, word_count, topic, summary, next_steps, themes, confidence, classifier, classified_at, transcript)
  SELECT rowid, org_id, source_id, preached_on, title, scripture, speaker, word_count, topic, summary, next_steps, themes, confidence, classifier, classified_at, transcript FROM sermons;

-- Old and new hold exactly the same rows, rowid included. Dropped again before
-- the old tables go: RENAME re-parses every trigger, temp ones included, and
-- fails on one that names a table no longer there.
CREATE TEMP TRIGGER _0095_check_copy BEFORE INSERT ON _0095_guard
WHEN NEW.step = 'copy' AND (
     EXISTS (SELECT rowid, * FROM attendance_service EXCEPT SELECT rowid, * FROM _0095_attendance_service)
  OR EXISTS (SELECT rowid, * FROM _0095_attendance_service EXCEPT SELECT rowid, * FROM attendance_service)
  OR EXISTS (SELECT rowid, * FROM builder_blocks EXCEPT SELECT rowid, * FROM _0095_builder_blocks)
  OR EXISTS (SELECT rowid, * FROM _0095_builder_blocks EXCEPT SELECT rowid, * FROM builder_blocks)
  OR EXISTS (SELECT rowid, * FROM builder_page_versions EXCEPT SELECT rowid, * FROM _0095_builder_page_versions)
  OR EXISTS (SELECT rowid, * FROM _0095_builder_page_versions EXCEPT SELECT rowid, * FROM builder_page_versions)
  OR EXISTS (SELECT rowid, * FROM cc_campaign_lists EXCEPT SELECT rowid, * FROM _0095_cc_campaign_lists)
  OR EXISTS (SELECT rowid, * FROM _0095_cc_campaign_lists EXCEPT SELECT rowid, * FROM cc_campaign_lists)
  OR EXISTS (SELECT rowid, * FROM cc_campaigns EXCEPT SELECT rowid, * FROM _0095_cc_campaigns)
  OR EXISTS (SELECT rowid, * FROM _0095_cc_campaigns EXCEPT SELECT rowid, * FROM cc_campaigns)
  OR EXISTS (SELECT rowid, * FROM cc_contact_activity EXCEPT SELECT rowid, * FROM _0095_cc_contact_activity)
  OR EXISTS (SELECT rowid, * FROM _0095_cc_contact_activity EXCEPT SELECT rowid, * FROM cc_contact_activity)
  OR EXISTS (SELECT rowid, * FROM cc_contact_lists EXCEPT SELECT rowid, * FROM _0095_cc_contact_lists)
  OR EXISTS (SELECT rowid, * FROM _0095_cc_contact_lists EXCEPT SELECT rowid, * FROM cc_contact_lists)
  OR EXISTS (SELECT rowid, * FROM cc_contacts EXCEPT SELECT rowid, * FROM _0095_cc_contacts)
  OR EXISTS (SELECT rowid, * FROM _0095_cc_contacts EXCEPT SELECT rowid, * FROM cc_contacts)
  OR EXISTS (SELECT rowid, * FROM cc_lists EXCEPT SELECT rowid, * FROM _0095_cc_lists)
  OR EXISTS (SELECT rowid, * FROM _0095_cc_lists EXCEPT SELECT rowid, * FROM cc_lists)
  OR EXISTS (SELECT rowid, * FROM cc_sync_cursor EXCEPT SELECT rowid, * FROM _0095_cc_sync_cursor)
  OR EXISTS (SELECT rowid, * FROM _0095_cc_sync_cursor EXCEPT SELECT rowid, * FROM cc_sync_cursor)
  OR EXISTS (SELECT rowid, * FROM cc_sync_runs EXCEPT SELECT rowid, * FROM _0095_cc_sync_runs)
  OR EXISTS (SELECT rowid, * FROM _0095_cc_sync_runs EXCEPT SELECT rowid, * FROM cc_sync_runs)
  OR EXISTS (SELECT rowid, * FROM pco_plan_items EXCEPT SELECT rowid, * FROM _0095_pco_plan_items)
  OR EXISTS (SELECT rowid, * FROM _0095_pco_plan_items EXCEPT SELECT rowid, * FROM pco_plan_items)
  OR EXISTS (SELECT rowid, * FROM retention_engagement EXCEPT SELECT rowid, * FROM _0095_retention_engagement)
  OR EXISTS (SELECT rowid, * FROM _0095_retention_engagement EXCEPT SELECT rowid, * FROM retention_engagement)
  OR EXISTS (SELECT rowid, * FROM retention_returns EXCEPT SELECT rowid, * FROM _0095_retention_returns)
  OR EXISTS (SELECT rowid, * FROM _0095_retention_returns EXCEPT SELECT rowid, * FROM retention_returns)
  OR EXISTS (SELECT rowid, * FROM sermons EXCEPT SELECT rowid, * FROM _0095_sermons)
  OR EXISTS (SELECT rowid, * FROM _0095_sermons EXCEPT SELECT rowid, * FROM sermons))
BEGIN
  SELECT RAISE(ROLLBACK, '0095 refused (copy): a rebuilt table does not hold exactly the rows of the old one. Nothing was changed.');
END;
INSERT INTO _0095_guard (step) VALUES ('copy');
DROP TRIGGER _0095_check_copy;

DROP TABLE attendance_service;
DROP TABLE builder_blocks;
DROP TABLE builder_page_versions;
DROP TABLE cc_campaign_lists;
DROP TABLE cc_campaigns;
DROP TABLE cc_contact_activity;
DROP TABLE cc_contact_lists;
DROP TABLE cc_contacts;
DROP TABLE cc_lists;
DROP TABLE cc_sync_cursor;
DROP TABLE cc_sync_runs;
DROP TABLE pco_plan_items;
DROP TABLE retention_engagement;
DROP TABLE retention_returns;
DROP TABLE sermons;

ALTER TABLE _0095_attendance_service RENAME TO attendance_service;
ALTER TABLE _0095_builder_blocks RENAME TO builder_blocks;
ALTER TABLE _0095_builder_page_versions RENAME TO builder_page_versions;
ALTER TABLE _0095_cc_campaign_lists RENAME TO cc_campaign_lists;
ALTER TABLE _0095_cc_campaigns RENAME TO cc_campaigns;
ALTER TABLE _0095_cc_contact_activity RENAME TO cc_contact_activity;
ALTER TABLE _0095_cc_contact_lists RENAME TO cc_contact_lists;
ALTER TABLE _0095_cc_contacts RENAME TO cc_contacts;
ALTER TABLE _0095_cc_lists RENAME TO cc_lists;
ALTER TABLE _0095_cc_sync_cursor RENAME TO cc_sync_cursor;
ALTER TABLE _0095_cc_sync_runs RENAME TO cc_sync_runs;
ALTER TABLE _0095_pco_plan_items RENAME TO pco_plan_items;
ALTER TABLE _0095_retention_engagement RENAME TO retention_engagement;
ALTER TABLE _0095_retention_returns RENAME TO retention_returns;
ALTER TABLE _0095_sermons RENAME TO sermons;

-- The indexes, exactly as they were.
CREATE INDEX attendance_service_week
  ON attendance_service(org_id, sunday_on);
CREATE INDEX builder_blocks_page ON builder_blocks(page_id, position);
CREATE INDEX builder_page_versions_page ON builder_page_versions(page_id, id);
CREATE INDEX cc_campaigns_activity ON cc_campaigns(org_id, campaign_activity_id);
CREATE INDEX cc_campaigns_sent ON cc_campaigns(org_id, last_sent_at);
CREATE INDEX cc_activity_contact ON cc_contact_activity(org_id, contact_id, activity_type);
CREATE INDEX cc_activity_campaign ON cc_contact_activity(org_id, campaign_activity_id, activity_type);
CREATE INDEX cc_contacts_hash ON cc_contacts(org_id, email_hash);
CREATE INDEX cc_contacts_person ON cc_contacts(org_id, person_id);
CREATE INDEX idx_plan_items_plan ON pco_plan_items(org_id, plan_id);
CREATE INDEX idx_plan_items_st ON pco_plan_items(org_id, service_type_id);
CREATE INDEX idx_sermons_org_date ON sermons(org_id, preached_on);

-- The copy set each AUTOINCREMENT counter to the highest id; put back the
-- saved values, which also remember ids used by rows deleted since.
DELETE FROM sqlite_sequence WHERE name IN (SELECT name FROM _0095_tables);
INSERT INTO sqlite_sequence (name, seq) SELECT name, seq FROM _0095_seq;

-- DROP TABLE deleted the statistics; the data is identical, so the saved rows
-- are exactly as accurate as before and query plans do not change.
DELETE FROM sqlite_stat1 WHERE tbl IN (SELECT name FROM _0095_tables);
INSERT INTO sqlite_stat1 SELECT * FROM _0095_stat1;
DELETE FROM sqlite_stat4 WHERE tbl IN (SELECT name FROM _0095_tables);
INSERT INTO sqlite_stat4 SELECT * FROM _0095_stat4;

-- The remaining checks, created only now that the tables are back in place.
-- No row count here: the copy check above already proved every table
-- identical, rowid included, and nothing has written since.
-- Each table now has exactly one key on org_id, to organizations(id), CASCADE,
-- and every row satisfies every key it has (builder_blocks and
-- builder_page_versions also keep page_id -> builder_pages).
CREATE TEMP TRIGGER _0095_check_keys BEFORE INSERT ON _0095_guard
WHEN NEW.step = 'keys' AND (
     EXISTS (SELECT 1 FROM _0095_tables t
              WHERE (SELECT COUNT(*) FROM pragma_foreign_key_list(t.name) f
                      WHERE f."table" = 'organizations' AND f."from" = 'org_id' AND f."to" = 'id'
                        AND f.on_delete = 'CASCADE') <> 1
                 OR (SELECT COUNT(*) FROM pragma_foreign_key_list(t.name) f WHERE f."from" = 'org_id') <> 1)
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('attendance_service'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('builder_blocks'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('builder_page_versions'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('cc_campaign_lists'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('cc_campaigns'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('cc_contact_activity'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('cc_contact_lists'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('cc_contacts'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('cc_lists'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('cc_sync_cursor'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('cc_sync_runs'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('pco_plan_items'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('retention_engagement'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('retention_returns'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('sermons')))
BEGIN
  SELECT RAISE(ROLLBACK, '0095 refused (keys): a rebuilt table has a row whose org_id is not in organizations (or whose page_id is not in builder_pages), or its org key is not as declared. See PRAGMA foreign_key_check(<table>). Nothing was changed.');
END;

CREATE TEMP TRIGGER _0095_check_indexes BEFORE INSERT ON _0095_guard
WHEN NEW.step = 'indexes' AND (
     EXISTS (SELECT name, tbl_name, sql FROM _0095_indexes
             EXCEPT SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index')
  OR EXISTS (SELECT name, tbl_name, sql FROM sqlite_master
              WHERE type = 'index' AND tbl_name IN (SELECT name FROM _0095_tables)
             EXCEPT SELECT name, tbl_name, sql FROM _0095_indexes))
BEGIN
  SELECT RAISE(ROLLBACK, '0095 refused (indexes): the rebuilt tables do not have exactly their old indexes. Nothing was changed.');
END;

CREATE TEMP TRIGGER _0095_check_counters BEFORE INSERT ON _0095_guard
WHEN NEW.step = 'counters' AND (
     EXISTS (SELECT name, seq FROM _0095_seq EXCEPT SELECT name, seq FROM sqlite_sequence)
  OR EXISTS (SELECT name, seq FROM sqlite_sequence WHERE name IN (SELECT name FROM _0095_tables)
             EXCEPT SELECT name, seq FROM _0095_seq))
BEGIN
  SELECT RAISE(ROLLBACK, '0095 refused (counters): an AUTOINCREMENT counter moved. Nothing was changed.');
END;

CREATE TEMP TRIGGER _0095_check_stats BEFORE INSERT ON _0095_guard
WHEN NEW.step = 'stats' AND (
     EXISTS (SELECT * FROM _0095_stat1 EXCEPT SELECT * FROM sqlite_stat1)
  OR EXISTS (SELECT * FROM sqlite_stat1 WHERE tbl IN (SELECT name FROM _0095_tables) EXCEPT SELECT * FROM _0095_stat1)
  OR EXISTS (SELECT * FROM _0095_stat4 EXCEPT SELECT * FROM sqlite_stat4)
  OR EXISTS (SELECT * FROM sqlite_stat4 WHERE tbl IN (SELECT name FROM _0095_tables) EXCEPT SELECT * FROM _0095_stat4))
BEGIN
  SELECT RAISE(ROLLBACK, '0095 refused (stats): the planner statistics for the rebuilt tables changed. Nothing was changed.');
END;

-- quick_check, not integrity_check: the full check also re-reads every index
-- entry against its row (0.6 s for cc_contact_activity alone, with the write
-- lock held), and these indexes were built from these rows moments ago. The
-- full integrity_check was run on the production copy.
CREATE TEMP TRIGGER _0095_check_integrity BEFORE INSERT ON _0095_guard
WHEN NEW.step = 'integrity' AND (
     (SELECT group_concat(quick_check) FROM pragma_quick_check('attendance_service')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('builder_blocks')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('builder_page_versions')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('cc_campaign_lists')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('cc_campaigns')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('cc_contact_activity')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('cc_contact_lists')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('cc_contacts')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('cc_lists')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('cc_sync_cursor')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('cc_sync_runs')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('pco_plan_items')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('retention_engagement')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('retention_returns')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('sermons')) IS NOT 'ok')
BEGIN
  SELECT RAISE(ROLLBACK, '0095 refused (integrity): PRAGMA quick_check reports a problem in a rebuilt table. Nothing was changed.');
END;

INSERT INTO _0095_guard (step) VALUES
  ('keys'), ('indexes'), ('counters'), ('stats'), ('integrity');

DROP TABLE _0095_guard;
DROP TABLE _0095_tables;
DROP TABLE _0095_indexes;
DROP TABLE _0095_seq;
DROP TABLE _0095_stat1;
DROP TABLE _0095_stat4;
DROP TABLE _0095_variants;

-- Recorded here so the rebuild and its record commit together (see the
-- header). The runners' own INSERT OR IGNORE afterwards is then a no-op.
INSERT OR IGNORE INTO _migrations (filename) VALUES ('0095_org_keys.sql');

COMMIT;

PRAGMA foreign_keys = ON;
