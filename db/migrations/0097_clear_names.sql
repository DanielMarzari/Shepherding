-- Names that say what the table or column holds, for someone reading the
-- database for the first time. What each one holds was measured on the
-- 2026-09-21 production copy after 0096.
--
-- Constant Contact was spelled three ways: constant_contact_credentials, the
-- cc_ data tables (which, in an email schema, read as "carbon copy") and
-- constantcontact_ (0092 retired that one). Everything is constant_contact_
-- now, and the membership table is named like pco_list_memberships:
--
--   cc_contacts            -> constant_contact_contacts            18,044 rows
--   cc_contact_activity    -> constant_contact_activity           234,314
--   cc_lists               -> constant_contact_lists                   72
--   cc_contact_lists       -> constant_contact_list_memberships    23,678
--   cc_campaigns           -> constant_contact_campaigns            4,928
--   cc_campaign_lists      -> constant_contact_campaign_lists         288
--   cc_sync_runs           -> constant_contact_sync_runs               10
--   cc_sync_cursor         -> constant_contact_sync_cursor              1
--   cc_sync_settings       -> constant_contact_sync_settings            1
--   cc_contact_engagement  -> constant_contact_engagement           6,277
--   cc_link_clicks         -> constant_contact_link_clicks            281
--   cc_engagement_snapshot -> constant_contact_engagement_snapshot      1
--
-- Their six named indexes move to the same prefix (cc_activity_contact ->
-- constant_contact_activity_contact, and so on). SQLite cannot rename an
-- index, so each is dropped and created again with the same columns; the two
-- on the activity table are the largest part of this file's time (0.3-0.6 s
-- together on the copy). The rows keep their rowids: RENAME rewrites the schema, not the
-- table. That matters for the email-engagement rollups, whose staleness check
-- (isCcEngagementStale in src/lib/constant-contact-sync.ts) compares the
-- activity table's MAX(rowid) with the watermark stored when they were built;
-- the check below proves the maximum and the row count did not move.
--
-- The rest:
--
--   person_mesh -> road_network_routed_people, meshed_at -> routed_at.
--     One row per person whose home has been routed from the church by OSRM
--     and folded into road_network, so the next run skips them (8,026 rows).
--     A home whose route request failed is recorded too, and is not retried.
--     It was named after road_mesh, which 0096 dropped; every row is newer than
--     road_network (0052).
--   person_drive -> person_drive_from_church. Driving miles and minutes
--     between the church and each geocoded home (25,466 ok, 218 fail). Not
--     "to church": the OSRM table request uses the church as the source and
--     the homes as destinations, and on one-way streets that direction can
--     differ from the drive in. "drive" alone read like a fundraising drive.
--   pco_plan_items.length -> duration_seconds. PCO's Item length, in seconds:
--     sermons 1440, songs 180-466, prayers 60; 0077 already said "seconds".
--     `length` also shadowed SQLite's length() function.
--   retention_engagement.first_mi / last_mi -> first_activity_month_index /
--     last_activity_month_index. The first and last month a person had dated
--     activity (a check-in, event attendance or plan serving), as year * 12 +
--     month - 1: 24312 is January 2026. Months as integers so the retention
--     code can subtract them. refreshRetentionReturns in
--     src/lib/retention-read.ts computes them.
--   pco_people.given_name -> legal_first_name. PCO's given_name is the legal
--     first name, the opposite of what "given name" usually means next to a
--     first_name: first_name 'Tom', given_name 'Thomas' (961 set, 911 of them
--     differ from first_name). The sync still reads PCO's attribute as
--     given_name.
--   person_activity.in_lane_wors / in_lane_comm / in_lane_serv ->
--     in_worship_lane / in_community_lane / in_serving_lane. Only the columns:
--     the lane keys in URLs and stored settings (wors, comm, serv) stay.
--   person_activity.last_form_at -> last_form_submission_at. It is a copy of
--     pco_people.last_form_submission_at made by the activity refresh (all
--     34,522 rows equal), so it now has the same name.
--   pco_checkin_events -> pco_check_in_events, pco_checkin_locations ->
--     pco_check_in_locations, spelled like pco_check_ins. (pco_sync_settings
--     still has six *_checkin_* columns; renaming them is separate work.)
--   pco_registration_signups.archived -> is_archived. A 0/1 flag (894 of 931
--     are 1) among tables whose archived_at columns hold timestamps. PCO's
--     attribute is still read as archived.
--
-- No foreign key, view or trigger names any renamed table: every renamed
-- table's only key is its own org_id -> organizations, which RENAME leaves as
-- it is. The primary keys' automatic indexes follow the table name by
-- themselves, and so does cc_sync_runs' sqlite_sequence row. The planner
-- statistics do not: RENAME leaves sqlite_stat1/stat4 rows under the old names
-- (the planner would lose them) and DROP INDEX deletes its index's rows, so
-- they are moved to the new names first. 0092's rename of
-- constantcontact_credentials left that table's one row behind the same way;
-- it moves too. On the copy no statistic names a missing table or index
-- afterwards.
--
-- Stored builder SQL is rewritten in the same transaction, as 0090 and 0093
-- did. On the copy, a word-boundary search of every string in
-- builder_blocks.config and builder_page_versions.snapshot (each Undo
-- snapshot's block configs decoded too) finds cc_campaigns in 9 blocks,
-- pco_checkin_events in 12 and the three lane columns in 1: 22 blocks, no Undo
-- snapshots. Every occurrence is the table or column inside a query. All 30
-- old names are replaced, which also covers a query saved between that copy
-- and this deploy. The plain replace() is exact because the guard first
-- refuses if any old name sits inside a longer identifier. length and
-- archived are too common to replace (length() and "archived" in prose occur
-- 18 times), and no stored query reads either column; the guard refuses if one
-- starts to. Every rewritten query still runs and returns the same rows.
--
-- Seeded pages stay consistent, as in 0090 and 0093. Only config and snapshot
-- text change and builder_pages is not touched, so no page starts to look
-- edited. The Ministry Impact Report templates in src/lib/mir-metrics.ts use
-- the new names, so their fingerprints change and each pristine page is
-- replaced once from its template; where it was current the new blocks are
-- byte-identical to what this writes. The hand-numbered seeds whose SQL
-- changed (checkins and email-dashboard in src/lib/builder-seeds.ts) went up
-- one revision, so a pristine copy the old code creates during the deploy is
-- replaced too. The edited Check-ins page is never replaced, so this migration
-- is the only thing that fixes it.
--
-- The old code keeps serving between this file and the pm2 restart, and for
-- those seconds anything it runs against a renamed table or column fails with
-- "no such table" or "no such column": among others the Constant Contact pages
-- and sync, check-ins, the map's drive and road layers, retention, the
-- activity snapshot refresh, PushPay matching, and a PCO sync writing people,
-- plan items or registrations. The next run of a sync or refresh redoes its
-- work. Stored builder queries keep working: the old code reads them from the
-- database, already rewritten. A pristine page the old code re-seeds in that
-- window gets the old names back, and the new code replaces it on the next
-- visit, since its fingerprint or revision differs. On the copy the file
-- takes 0.8-1.4 s (four runs), holding the write lock throughout; readers
-- are not blocked.
--
-- If a check fails, the guard (a throwaway TEMP table and triggers, as in
-- 0092) rolls back the whole file with a message naming the check, and nothing
-- changes. IMMEDIATE for the reason 0092 gives: the guard reads before
-- anything writes. The file records itself in _migrations just before COMMIT
-- (see 0094's header), so the change and its record commit together.
BEGIN IMMEDIATE;

CREATE TEMP TABLE _0097_guard (step TEXT NOT NULL);

CREATE TEMP TABLE _0097_tables (old TEXT PRIMARY KEY, new TEXT NOT NULL UNIQUE);
INSERT INTO _0097_tables (old, new) VALUES
  ('cc_contacts',            'constant_contact_contacts'),
  ('cc_contact_activity',    'constant_contact_activity'),
  ('cc_lists',               'constant_contact_lists'),
  ('cc_contact_lists',       'constant_contact_list_memberships'),
  ('cc_campaigns',           'constant_contact_campaigns'),
  ('cc_campaign_lists',      'constant_contact_campaign_lists'),
  ('cc_sync_runs',           'constant_contact_sync_runs'),
  ('cc_sync_cursor',         'constant_contact_sync_cursor'),
  ('cc_sync_settings',       'constant_contact_sync_settings'),
  ('cc_contact_engagement',  'constant_contact_engagement'),
  ('cc_link_clicks',         'constant_contact_link_clicks'),
  ('cc_engagement_snapshot', 'constant_contact_engagement_snapshot'),
  ('person_mesh',            'road_network_routed_people'),
  ('person_drive',           'person_drive_from_church'),
  ('pco_checkin_events',     'pco_check_in_events'),
  ('pco_checkin_locations',  'pco_check_in_locations');

CREATE TEMP TABLE _0097_indexes (
  old TEXT PRIMARY KEY, new TEXT NOT NULL UNIQUE, old_tbl TEXT NOT NULL, new_tbl TEXT NOT NULL,
  cols TEXT, is_unique INTEGER);
INSERT INTO _0097_indexes (old, new, old_tbl, new_tbl) VALUES
  ('cc_activity_contact',   'constant_contact_activity_contact',  'cc_contact_activity', 'constant_contact_activity'),
  ('cc_activity_campaign',  'constant_contact_activity_campaign', 'cc_contact_activity', 'constant_contact_activity'),
  ('cc_campaigns_activity', 'constant_contact_campaigns_activity', 'cc_campaigns',       'constant_contact_campaigns'),
  ('cc_campaigns_sent',     'constant_contact_campaigns_sent',    'cc_campaigns',        'constant_contact_campaigns'),
  ('cc_contacts_hash',      'constant_contact_contacts_hash',     'cc_contacts',         'constant_contact_contacts'),
  ('cc_contacts_person',    'constant_contact_contacts_person',   'cc_contacts',         'constant_contact_contacts');
-- Key columns in order, with direction and collation, to compare after.
UPDATE _0097_indexes SET
  cols = (SELECT group_concat(x.name || ' ' || x."desc" || ' ' || x.coll, ', ' ORDER BY x.seqno)
            FROM pragma_index_xinfo(_0097_indexes.old) x WHERE x.key = 1),
  is_unique = (SELECT l."unique" FROM pragma_index_list(_0097_indexes.old_tbl) l
                WHERE l.name = _0097_indexes.old);

-- Every old name that stored builder text may contain, and its replacement.
-- Longest first, so no name is replaced inside a longer one (the guard below
-- also refuses that case outright).
CREATE TEMP TABLE _0097_words (n INTEGER PRIMARY KEY, old TEXT NOT NULL UNIQUE, new TEXT NOT NULL);
INSERT INTO _0097_words (old, new)
  SELECT old, new FROM (
    SELECT old, new FROM _0097_tables
    UNION ALL SELECT old, new FROM _0097_indexes
    UNION ALL VALUES
      ('meshed_at',    'routed_at'),
      ('first_mi',     'first_activity_month_index'),
      ('last_mi',      'last_activity_month_index'),
      ('given_name',   'legal_first_name'),
      ('in_lane_wors', 'in_worship_lane'),
      ('in_lane_comm', 'in_community_lane'),
      ('in_lane_serv', 'in_serving_lane'),
      ('last_form_at', 'last_form_submission_at'))
  ORDER BY length(old) DESC, old;

-- Every string in stored builder text, decoded: each block config's leaves,
-- and each Undo snapshot's leaves with its block configs decoded again. Text
-- that is not JSON is taken whole. JSON escapes (a newline is \n) would
-- otherwise put a letter in front of an identifier.
CREATE TEMP VIEW _0097_text AS
  SELECT 'block ' || b.id AS src, t.key AS key, t.value AS s
    FROM builder_blocks b,
         json_tree(CASE WHEN json_valid(b.config) THEN b.config ELSE json_quote(b.config) END) t
   WHERE t.type = 'text'
  UNION ALL
  SELECT 'undo ' || v.id, t.key, t.value
    FROM builder_page_versions v,
         json_tree(CASE WHEN json_valid(v.snapshot) THEN v.snapshot ELSE json_quote(v.snapshot) END) t
   WHERE t.type = 'text' AND t.key IS NOT 'config'
  UNION ALL
  SELECT 'undo ' || v.id, c.key, c.value
    FROM builder_page_versions v,
         json_tree(CASE WHEN json_valid(v.snapshot) THEN v.snapshot ELSE json_quote(v.snapshot) END) t,
         json_tree(CASE WHEN json_valid(t.value) THEN t.value ELSE json_quote(t.value) END) c
   WHERE t.type = 'text' AND t.key = 'config' AND c.type = 'text';

-- What must come through unchanged, saved before anything moves.
CREATE TEMP TABLE _0097_saved AS SELECT
  (SELECT COALESCE(MAX(rowid), 0) FROM cc_contact_activity) AS activity_max_rowid,
  (SELECT COUNT(*) FROM cc_contact_activity) AS activity_rows,
  (SELECT COUNT(*) FROM builder_blocks WHERE json_valid(config)) AS valid_configs,
  (SELECT COUNT(*) FROM builder_page_versions WHERE json_valid(snapshot)) AS valid_snapshots;
-- The planner statistics as they must read afterwards: same rows, new names.
CREATE TEMP TABLE _0097_stat1 AS
  SELECT t.new AS tbl,
         COALESCE(i.new, CASE WHEN s.idx LIKE 'sqlite!_autoindex!_%' ESCAPE '!'
                              THEN 'sqlite_autoindex_' || t.new || substr(s.idx, length(t.old) + 18)
                              ELSE s.idx END) AS idx,
         s.stat
    FROM sqlite_stat1 s JOIN _0097_tables t ON t.old = s.tbl
    LEFT JOIN _0097_indexes i ON i.old = s.idx;
CREATE TEMP TABLE _0097_stat4 AS
  SELECT t.new AS tbl,
         COALESCE(i.new, CASE WHEN s.idx LIKE 'sqlite!_autoindex!_%' ESCAPE '!'
                              THEN 'sqlite_autoindex_' || t.new || substr(s.idx, length(t.old) + 18)
                              ELSE s.idx END) AS idx,
         s.neq, s.nlt, s.ndlt, s.sample
    FROM sqlite_stat4 s JOIN _0097_tables t ON t.old = s.tbl
    LEFT JOIN _0097_indexes i ON i.old = s.idx;

-- An old name inside a longer identifier (cc_campaigns_2024, xperson_drive)
-- would be mangled by replace(). Case is ignored: SQL names are.
CREATE TEMP TRIGGER _0097_refuse_boundary BEFORE INSERT ON _0097_guard
WHEN NEW.step = 'boundary' AND EXISTS (
  SELECT 1 FROM _0097_text x, _0097_words w
   WHERE instr(lower(x.s), w.old) > 0
     AND (lower(x.s) GLOB '*[a-z0-9_]' || w.old || '*' OR lower(x.s) GLOB '*' || w.old || '[a-z0-9_]*'))
BEGIN
  SELECT RAISE(ROLLBACK, '0097 refused (boundary): a builder block or Undo snapshot has a name this renames inside a longer name, which replace() would mangle. Edit that query by hand, then deploy again. Nothing was changed.');
END;

-- A stored query reading pco_plan_items.length or
-- pco_registration_signups.archived: the word as a name in a query on that
-- table. length followed by ( is the function; whitespace before the ( is
-- folded away first. A comment using the word also refuses, harmlessly.
CREATE TEMP TRIGGER _0097_refuse_generic BEFORE INSERT ON _0097_guard
WHEN NEW.step = 'generic' AND EXISTS (
  SELECT 1 FROM (
    SELECT replace(replace(replace(replace(replace(replace(lower(x.s),
             char(9), ' '), char(10), ' '), char(13), ' '), '  ', ' '), '  ', ' '), ' (', '(') AS q
      FROM _0097_text x WHERE x.key = 'sql')
   WHERE (instr(q, 'pco_plan_items') > 0
          AND (q GLOB '*[^a-z0-9_]length[^a-z0-9_(]*' OR q GLOB '*[^a-z0-9_]length'))
      OR (instr(q, 'pco_registration_signups') > 0
          AND (q GLOB '*[^a-z0-9_]archived[^a-z0-9_]*' OR q GLOB '*[^a-z0-9_]archived')))
BEGIN
  SELECT RAISE(ROLLBACK, '0097 refused (generic): a stored query on pco_plan_items or pco_registration_signups uses length or archived as a name (a column, an alias or a word in a comment). Point it at duration_seconds or is_archived, or reword it, then deploy again. Nothing was changed.');
END;

INSERT INTO _0097_guard (step) VALUES ('boundary'), ('generic');

DROP TRIGGER _0097_refuse_boundary;
DROP TRIGGER _0097_refuse_generic;

-- Statistics first: DROP INDEX below would delete its index's rows.
UPDATE sqlite_stat1 SET idx = (SELECT new FROM _0097_indexes WHERE old = sqlite_stat1.idx)
 WHERE idx IN (SELECT old FROM _0097_indexes);
UPDATE sqlite_stat1
   SET idx = 'sqlite_autoindex_' || (SELECT new FROM _0097_tables WHERE old = sqlite_stat1.tbl)
             || substr(idx, length(tbl) + 18)
 WHERE tbl IN (SELECT old FROM _0097_tables) AND idx LIKE 'sqlite!_autoindex!_%' ESCAPE '!';
UPDATE sqlite_stat1 SET tbl = (SELECT new FROM _0097_tables WHERE old = sqlite_stat1.tbl)
 WHERE tbl IN (SELECT old FROM _0097_tables);
UPDATE sqlite_stat4 SET idx = (SELECT new FROM _0097_indexes WHERE old = sqlite_stat4.idx)
 WHERE idx IN (SELECT old FROM _0097_indexes);
UPDATE sqlite_stat4
   SET idx = 'sqlite_autoindex_' || (SELECT new FROM _0097_tables WHERE old = sqlite_stat4.tbl)
             || substr(idx, length(tbl) + 18)
 WHERE tbl IN (SELECT old FROM _0097_tables) AND idx LIKE 'sqlite!_autoindex!_%' ESCAPE '!';
UPDATE sqlite_stat4 SET tbl = (SELECT new FROM _0097_tables WHERE old = sqlite_stat4.tbl)
 WHERE tbl IN (SELECT old FROM _0097_tables);
UPDATE sqlite_stat1 SET tbl = 'constant_contact_credentials'
 WHERE tbl = 'constantcontact_credentials'
   AND NOT EXISTS (SELECT 1 FROM sqlite_stat1 WHERE tbl = 'constant_contact_credentials');
DELETE FROM sqlite_stat1 WHERE tbl = 'constantcontact_credentials';
DELETE FROM sqlite_stat4 WHERE tbl = 'constantcontact_credentials';

ALTER TABLE cc_contacts            RENAME TO constant_contact_contacts;
ALTER TABLE cc_contact_activity    RENAME TO constant_contact_activity;
ALTER TABLE cc_lists               RENAME TO constant_contact_lists;
ALTER TABLE cc_contact_lists       RENAME TO constant_contact_list_memberships;
ALTER TABLE cc_campaigns           RENAME TO constant_contact_campaigns;
ALTER TABLE cc_campaign_lists      RENAME TO constant_contact_campaign_lists;
ALTER TABLE cc_sync_runs           RENAME TO constant_contact_sync_runs;
ALTER TABLE cc_sync_cursor         RENAME TO constant_contact_sync_cursor;
ALTER TABLE cc_sync_settings       RENAME TO constant_contact_sync_settings;
ALTER TABLE cc_contact_engagement  RENAME TO constant_contact_engagement;
ALTER TABLE cc_link_clicks         RENAME TO constant_contact_link_clicks;
ALTER TABLE cc_engagement_snapshot RENAME TO constant_contact_engagement_snapshot;
ALTER TABLE person_mesh            RENAME TO road_network_routed_people;
ALTER TABLE person_drive           RENAME TO person_drive_from_church;
ALTER TABLE pco_checkin_events     RENAME TO pco_check_in_events;
ALTER TABLE pco_checkin_locations  RENAME TO pco_check_in_locations;

ALTER TABLE road_network_routed_people RENAME COLUMN meshed_at    TO routed_at;
ALTER TABLE pco_plan_items             RENAME COLUMN length       TO duration_seconds;
ALTER TABLE retention_engagement       RENAME COLUMN first_mi     TO first_activity_month_index;
ALTER TABLE retention_engagement       RENAME COLUMN last_mi      TO last_activity_month_index;
ALTER TABLE pco_people                 RENAME COLUMN given_name   TO legal_first_name;
ALTER TABLE person_activity            RENAME COLUMN in_lane_wors TO in_worship_lane;
ALTER TABLE person_activity            RENAME COLUMN in_lane_comm TO in_community_lane;
ALTER TABLE person_activity            RENAME COLUMN in_lane_serv TO in_serving_lane;
ALTER TABLE person_activity            RENAME COLUMN last_form_at TO last_form_submission_at;
ALTER TABLE pco_registration_signups   RENAME COLUMN archived     TO is_archived;

DROP INDEX cc_activity_contact;
CREATE INDEX constant_contact_activity_contact ON constant_contact_activity(org_id, contact_id, activity_type);
DROP INDEX cc_activity_campaign;
CREATE INDEX constant_contact_activity_campaign ON constant_contact_activity(org_id, campaign_activity_id, activity_type);
DROP INDEX cc_campaigns_activity;
CREATE INDEX constant_contact_campaigns_activity ON constant_contact_campaigns(org_id, campaign_activity_id);
DROP INDEX cc_campaigns_sent;
CREATE INDEX constant_contact_campaigns_sent ON constant_contact_campaigns(org_id, last_sent_at);
DROP INDEX cc_contacts_hash;
CREATE INDEX constant_contact_contacts_hash ON constant_contact_contacts(org_id, email_hash);
DROP INDEX cc_contacts_person;
CREATE INDEX constant_contact_contacts_person ON constant_contact_contacts(org_id, person_id);

-- Every old name, in turn, in each block and Undo snapshot that has one. The
-- names hold nothing JSON escapes, so the raw text takes the same replace in
-- config and in snapshot, where each config is a JSON string inside JSON.
UPDATE builder_blocks
   SET config = (
       WITH RECURSIVE r(n, s) AS (
         SELECT 0, builder_blocks.config
         UNION ALL
         SELECT r.n + 1, replace(r.s, w.old, w.new) FROM r JOIN _0097_words w ON w.n = r.n + 1)
       SELECT s FROM r ORDER BY n DESC LIMIT 1)
 WHERE EXISTS (SELECT 1 FROM _0097_words w WHERE instr(builder_blocks.config, w.old) > 0);

UPDATE builder_page_versions
   SET snapshot = (
       WITH RECURSIVE r(n, s) AS (
         SELECT 0, builder_page_versions.snapshot
         UNION ALL
         SELECT r.n + 1, replace(r.s, w.old, w.new) FROM r JOIN _0097_words w ON w.n = r.n + 1)
       SELECT s FROM r ORDER BY n DESC LIMIT 1)
 WHERE EXISTS (SELECT 1 FROM _0097_words w WHERE instr(builder_page_versions.snapshot, w.old) > 0);

-- Checks, before COMMIT.

-- No old name is left as a name of its own (only a differently cased one can
-- be), and every config and snapshot that parsed before still parses.
CREATE TEMP TRIGGER _0097_check_stored_sql BEFORE INSERT ON _0097_guard
WHEN NEW.step = 'stored sql' AND (
     EXISTS (SELECT 1 FROM _0097_text x, _0097_words w
              WHERE instr(lower(x.s), w.old) > 0
                AND (lower(x.s) = w.old
                  OR lower(x.s) GLOB w.old || '[^a-z0-9_]*'
                  OR lower(x.s) GLOB '*[^a-z0-9_]' || w.old
                  OR lower(x.s) GLOB '*[^a-z0-9_]' || w.old || '[^a-z0-9_]*'))
  OR (SELECT COUNT(*) FROM builder_blocks WHERE json_valid(config)) <> (SELECT valid_configs FROM _0097_saved)
  OR (SELECT COUNT(*) FROM builder_page_versions WHERE json_valid(snapshot)) <> (SELECT valid_snapshots FROM _0097_saved))
BEGIN
  SELECT RAISE(ROLLBACK, '0097 refused (stored sql): a builder block or Undo snapshot still names an old table or column (in different letter case), or no longer parses. Edit that query by hand, then deploy again. Nothing was changed.');
END;

-- Every renamed index exists under its new name, on the renamed table, with
-- the same key columns, directions, collations and uniqueness; no index
-- keeps an old name.
CREATE TEMP TRIGGER _0097_check_indexes BEFORE INSERT ON _0097_guard
WHEN NEW.step = 'indexes' AND (
     EXISTS (SELECT 1 FROM _0097_indexes i
              WHERE i.cols IS NULL
                 OR (SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = i.new) IS NOT i.new_tbl
                 OR (SELECT group_concat(x.name || ' ' || x."desc" || ' ' || x.coll, ', ' ORDER BY x.seqno)
                       FROM pragma_index_xinfo(i.new) x WHERE x.key = 1) IS NOT i.cols
                 OR (SELECT l."unique" FROM pragma_index_list(i.new_tbl) l WHERE l.name = i.new) IS NOT i.is_unique)
  OR EXISTS (SELECT 1 FROM sqlite_master m
              WHERE m.name IN (SELECT old FROM _0097_indexes) OR m.name IN (SELECT old FROM _0097_tables)
                 OR m.tbl_name IN (SELECT old FROM _0097_tables)))
BEGIN
  SELECT RAISE(ROLLBACK, '0097 refused (indexes): a renamed index or table is missing, different, or still has its old name. Nothing was changed.');
END;

-- The planner statistics are the same rows under the new names, and none is
-- left under an old one.
CREATE TEMP TRIGGER _0097_check_stats BEFORE INSERT ON _0097_guard
WHEN NEW.step = 'stats' AND (
     EXISTS (SELECT * FROM _0097_stat1 EXCEPT SELECT * FROM sqlite_stat1)
  OR EXISTS (SELECT * FROM sqlite_stat1 WHERE tbl IN (SELECT new FROM _0097_tables) EXCEPT SELECT * FROM _0097_stat1)
  OR EXISTS (SELECT * FROM _0097_stat4 EXCEPT SELECT * FROM sqlite_stat4)
  OR EXISTS (SELECT * FROM sqlite_stat4 WHERE tbl IN (SELECT new FROM _0097_tables) EXCEPT SELECT * FROM _0097_stat4)
  OR EXISTS (SELECT 1 FROM sqlite_stat1
              WHERE tbl IN (SELECT old FROM _0097_tables) OR tbl = 'constantcontact_credentials'
                 OR idx IN (SELECT old FROM _0097_indexes))
  OR EXISTS (SELECT 1 FROM sqlite_stat4
              WHERE tbl IN (SELECT old FROM _0097_tables) OR tbl = 'constantcontact_credentials'
                 OR idx IN (SELECT old FROM _0097_indexes)))
BEGIN
  SELECT RAISE(ROLLBACK, '0097 refused (stats): the planner statistics did not follow the renamed tables and indexes. Nothing was changed.');
END;

-- The engagement rollups' watermark still describes the activity table.
CREATE TEMP TRIGGER _0097_check_watermark BEFORE INSERT ON _0097_guard
WHEN NEW.step = 'watermark' AND (
     (SELECT COALESCE(MAX(rowid), 0) FROM constant_contact_activity) <> (SELECT activity_max_rowid FROM _0097_saved)
  OR (SELECT COUNT(*) FROM constant_contact_activity) <> (SELECT activity_rows FROM _0097_saved))
BEGIN
  SELECT RAISE(ROLLBACK, '0097 refused (watermark): the Constant Contact activity rows or rowids changed. Nothing was changed.');
END;

-- Each renamed table keeps exactly its org key, and no row in it names a
-- missing organization. (Checking only these tables: the whole database took
-- ~0.9 s on the copy, for tables this file does not touch.)
CREATE TEMP TRIGGER _0097_check_keys BEFORE INSERT ON _0097_guard
WHEN NEW.step = 'keys' AND (
     EXISTS (SELECT 1 FROM _0097_tables t
              WHERE (SELECT COUNT(*) FROM pragma_foreign_key_list(t.new) f
                      WHERE f."table" = 'organizations' AND f."from" = 'org_id' AND f."to" = 'id'
                        AND f.on_delete = 'CASCADE') <> 1
                 OR (SELECT COUNT(*) FROM pragma_foreign_key_list(t.new)) <> 1
                 OR EXISTS (SELECT 1 FROM pragma_foreign_key_check(t.new))))
BEGIN
  SELECT RAISE(ROLLBACK, '0097 refused (keys): a renamed table lost its organization key, or PRAGMA foreign_key_check reports a row. Nothing was changed.');
END;

-- The three tables whose indexes were built again.
CREATE TEMP TRIGGER _0097_check_integrity BEFORE INSERT ON _0097_guard
WHEN NEW.step = 'integrity' AND (
     (SELECT group_concat(quick_check) FROM pragma_quick_check('constant_contact_activity')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('constant_contact_campaigns')) IS NOT 'ok'
  OR (SELECT group_concat(quick_check) FROM pragma_quick_check('constant_contact_contacts')) IS NOT 'ok')
BEGIN
  SELECT RAISE(ROLLBACK, '0097 refused (integrity): PRAGMA quick_check reports a problem in a reindexed table. Nothing was changed.');
END;

INSERT INTO _0097_guard (step) VALUES
  ('stored sql'), ('indexes'), ('stats'), ('watermark'), ('keys'), ('integrity');

DROP TRIGGER _0097_check_stored_sql;
DROP TRIGGER _0097_check_indexes;
DROP TRIGGER _0097_check_stats;
DROP TRIGGER _0097_check_watermark;
DROP TRIGGER _0097_check_keys;
DROP TRIGGER _0097_check_integrity;
DROP VIEW _0097_text;
DROP TABLE _0097_guard;
DROP TABLE _0097_tables;
DROP TABLE _0097_indexes;
DROP TABLE _0097_words;
DROP TABLE _0097_saved;
DROP TABLE _0097_stat1;
DROP TABLE _0097_stat4;

-- Recorded here so the change and its record commit together. The runners'
-- own INSERT OR IGNORE afterwards is then a no-op.
INSERT OR IGNORE INTO _migrations (filename) VALUES ('0097_clear_names.sql');

COMMIT;
