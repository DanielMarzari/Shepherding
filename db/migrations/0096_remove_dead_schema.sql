-- Remove schema nothing uses, so what is left in the database is what the app
-- actually reads. Each item below was checked against src/, scripts/ and the
-- SQL stored in builder_blocks.config and builder_page_versions.snapshot on the
-- 2026-09-21 production copy (after 0095). None of the dropped names occurs in
-- stored SQL, so nothing there is rewritten.
--
-- Tables, all empty on that copy:
--
--   road_mesh (0051)            The first road web, built from one-meter
--                               segments. 0052 replaced it with road_network
--                               and left it in place; nothing has read or
--                               written it since.
--   mir_team_members (0028)     The first Ministry Impact Reports: a form at
--   mir_docs (0026, 0027)       /mir that stored logic-model text, and a PDF
--                               importer. The reports people use are the
--                               mir-* builder pages (src/lib/mir-seeds.ts),
--                               which read neither table. /mir now redirects to
--                               them (next.config.ts). mir_docs once held one
--                               row (sqlite_sequence says 1); it was deleted.
--   attendance_sources (0026)   A list of links to attendance spreadsheets on
--                               /attendance. Never used; the .xlsx importer on
--                               the same card is what fills the charts, and
--                               stays.
--
-- mir_team_members is dropped before mir_docs. With foreign keys on, DROP TABLE
-- first deletes every row, and mir_team_members.mir_id REFERENCES mir_docs(id)
-- ON DELETE CASCADE. No other table, view or trigger names any of these four.
-- DROP also removes their indexes, planner statistics and sqlite_sequence
-- rows.
--
-- Columns:
--
--   cc_campaigns.stat_forwards, stat_abuse, stat_not_opened, stats_updated_at.
--   The Constant Contact sync wrote these on every run and nothing read them.
--   The other five stat_ columns stay: sends, opens and clicks feed the email
--   dashboards, the Communications reports and 6 stored blocks, and bounces
--   and opt-outs feed /constant-contact/dashboard's campaign table and monthly
--   trend (src/lib/constant-contact-read.ts). On the copy 4,521 of 4,928
--   campaigns carry the four dropped values. They can be fetched again from
--   Constant Contact's summary report if a page ever wants them.
--
--   pco_sync_settings.lapsed_from_team_weeks. 0013 (May) switched the
--   lapsed-from-team threshold to months and converted the value into
--   lapsed_from_team_months; every reader and writer moved with it. The
--   column still holds 26, the same six months that lapsed_from_team_months
--   holds as 6.
--
-- Rows:
--
--   pco_sync_cursor 'services:plans' (2035-01-01) and 'groups:events'
--   (2026-11-27). Commit a9f63d8 (2026-05-14) moved plans and group events to
--   a rolling re-fetch window and stopped reading or writing these cursors;
--   their last_synced_at is that day. A cursor years ahead reads like a broken
--   sync to anyone browsing the table. The keys the sync uses are all literal
--   ('people', 'checkins:check_ins', 'groups:applications') or
--   'form:<id>:submissions', so nothing can build either key again.
--
-- If something has written to a dropped table, or a builder block or Undo
-- snapshot has started to name a dropped table or column, the migration
-- refuses: the guard (a throwaway TEMP table and triggers, as in 0092) rolls
-- back the whole file with a message naming the check (rows or stored sql),
-- and nothing changes. "Empty when this was written" is not "empty when it runs". Look at
-- the rows or the query, move or delete them on purpose, then deploy again.
--
-- The old code keeps serving between this file and the pm2 restart. For those
-- few seconds /attendance and the old /mir pages fail with "no such table", a
-- PCO sync reaching its junk-name pass (HAS_OWNED_DATA_SQL named the mir
-- tables) fails, and so does a Constant Contact sync writing campaign stats.
-- The next run of either sync redoes the work. On the production copy the file
-- takes ~50 ms (three runs), most of it rewriting cc_campaigns' 4,928 rows
-- once per dropped column.
--
-- IMMEDIATE for the reason 0092 gives: the guard reads before anything writes.
-- A "database is locked" at BEGIN means nothing changed. The file records
-- itself in _migrations just before COMMIT (see 0094's header), so the change
-- and its record commit together.
BEGIN IMMEDIATE;

CREATE TEMP TABLE _0096_guard (step TEXT NOT NULL);

CREATE TEMP TRIGGER _0096_refuse_rows BEFORE INSERT ON _0096_guard
WHEN NEW.step = 'rows' AND (
     EXISTS (SELECT 1 FROM road_mesh)
  OR EXISTS (SELECT 1 FROM mir_docs)
  OR EXISTS (SELECT 1 FROM mir_team_members)
  OR EXISTS (SELECT 1 FROM attendance_sources))
BEGIN
  SELECT RAISE(ROLLBACK, '0096 refused (rows): road_mesh, mir_docs, mir_team_members or attendance_sources has a row. Look at it, keep what matters elsewhere or delete it, then deploy again. Nothing was changed.');
END;

-- Plain substrings: none of these names is part of a longer identifier in use.
CREATE TEMP TRIGGER _0096_refuse_stored_sql BEFORE INSERT ON _0096_guard
WHEN NEW.step = 'stored sql' AND (
     EXISTS (SELECT 1 FROM builder_blocks
              WHERE instr(config, 'road_mesh') > 0 OR instr(config, 'mir_docs') > 0
                 OR instr(config, 'mir_team_members') > 0 OR instr(config, 'attendance_sources') > 0
                 OR instr(config, 'stat_forwards') > 0 OR instr(config, 'stat_abuse') > 0
                 OR instr(config, 'stat_not_opened') > 0 OR instr(config, 'stats_updated_at') > 0
                 OR instr(config, 'lapsed_from_team_weeks') > 0)
  OR EXISTS (SELECT 1 FROM builder_page_versions
              WHERE instr(snapshot, 'road_mesh') > 0 OR instr(snapshot, 'mir_docs') > 0
                 OR instr(snapshot, 'mir_team_members') > 0 OR instr(snapshot, 'attendance_sources') > 0
                 OR instr(snapshot, 'stat_forwards') > 0 OR instr(snapshot, 'stat_abuse') > 0
                 OR instr(snapshot, 'stat_not_opened') > 0 OR instr(snapshot, 'stats_updated_at') > 0
                 OR instr(snapshot, 'lapsed_from_team_weeks') > 0))
BEGIN
  SELECT RAISE(ROLLBACK, '0096 refused (stored sql): a builder block or Undo snapshot names a table or column this drops. Edit the query to do without it, then deploy again. Nothing was changed.');
END;

INSERT INTO _0096_guard (step) VALUES ('rows'), ('stored sql');

DROP TRIGGER _0096_refuse_rows;
DROP TRIGGER _0096_refuse_stored_sql;
DROP TABLE _0096_guard;

DROP TABLE road_mesh;
DROP TABLE mir_team_members;
DROP TABLE mir_docs;
DROP TABLE attendance_sources;

ALTER TABLE cc_campaigns DROP COLUMN stat_forwards;
ALTER TABLE cc_campaigns DROP COLUMN stat_abuse;
ALTER TABLE cc_campaigns DROP COLUMN stat_not_opened;
ALTER TABLE cc_campaigns DROP COLUMN stats_updated_at;

ALTER TABLE pco_sync_settings DROP COLUMN lapsed_from_team_weeks;

DELETE FROM pco_sync_cursor WHERE resource IN ('services:plans', 'groups:events');

-- Recorded here so the change and its record commit together. The runners'
-- own INSERT OR IGNORE afterwards is then a no-op.
INSERT OR IGNORE INTO _migrations (filename) VALUES ('0096_remove_dead_schema.sql');

COMMIT;
