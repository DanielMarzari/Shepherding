-- Foreign keys from the hand-entered tables to the people they name.
--
-- Four tables hold data no sync can bring back: care rosters and their notes
-- (care_assignments), "I know them" marks from /know and /present
-- (shepherd_known_people), shepherd links (shepherd_assignments) and whole-org
-- access grants (org_wide_access). Each person column in them points at
-- pco_people(org_id, pco_id), but only by convention, so nothing stopped a
-- person row from being deleted out from under them. This declares
--
--   care_assignments       (org_id, shepherd_person_id), (org_id, person_id)
--   shepherd_known_people  (org_id, shepherd_person_id), (org_id, person_id)
--   shepherd_assignments   (org_id, shepherd_person_id)
--   org_wide_access        (org_id, person_id)
--
-- each REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT.
--
-- RESTRICT, not CASCADE. CASCADE would let a person deleted by the sync's
-- junk-name filter silently take their care notes and shepherd links with
-- them. With RESTRICT the DELETE fails with "FOREIGN KEY constraint failed"
-- and nothing is lost. The junk filter (refreshIsMinor in src/lib/pco-sync.ts)
-- keeps anyone with rows here and adds a sync warning, so in normal running it
-- never tries. It is the only code that deletes from pco_people; nothing
-- deletes organizations. (Deleting a whole organization still works in a
-- test: its cascade reaches these rebuilt tables before pco_people. That order
-- is SQLite's choice, not a promise; if it ever reaches pco_people first, the
-- RESTRICT fails the delete loudly. Clear these four tables for the org first.)
--
-- shepherd_assignments.target_id gets no key. It names a group, team, list,
-- membership type or person depending on target_kind, and a foreign key cannot
-- be conditional. The junk filter covers it: a person who is a
-- target_kind = 'person' target counts as having owned data.
--
-- On the 2026-09-21 production copy every person in these columns is in
-- pco_people (3 care rows, 1,731 known marks, 79 shepherd assignments, 0
-- org-wide grants), so every row carries over. Every write path takes its ids
-- from pco_people: the /care-map and /shepherd-map pickers, the /know and
-- /present sessions, and scripts/assign-roster.mjs. OR IGNORE does not cover
-- foreign keys, so the writers now check first: an id that left pco_people
-- after the page loaded is skipped (care-map people, known marks), refused
-- with a message (a shepherd), or reverts the switch (whole-org access), and
-- /know only signs in a shepherd who is in pco_people. Before, /know trusted
-- list membership and email hashes, which can name a person missing locally
-- (17 email hashes did on that copy).
--
-- There is deliberately NO orphan sweep here or anywhere else. On 2026-09-21
-- ~567 rows across the PCO mirror tables named people missing from pco_people.
-- They are not junk: 146 real people were missing locally because a
-- 2026-09-03 name-filter fix never re-fetched them (a cursor reset brings them
-- back). Deleting "orphans" would have destroyed real people's history.
--
-- How. SQLite cannot add a constraint to an existing table, so each table is
-- rebuilt by the documented procedure (https://sqlite.org/lang_altertable.html,
-- "Making Other Kinds Of Table Schema Changes"): foreign keys off outside the
-- transaction, create the new table under a temporary name, copy every row
-- with its id or rowid, drop the old table, rename the new one into place,
-- recreate its indexes, check, commit, foreign keys back on. The runner does
-- not wrap a file in a transaction, which is what lets the PRAGMA sit outside
-- BEGIN (SQLite ignores it inside one). No view, trigger or other table's key
-- names these four tables. The AUTOINCREMENT counters and the planner
-- statistics (sqlite_stat1/stat4, which DROP deletes) are saved first and put
-- back, so ids never repeat and query plans do not change. After the rename
-- sqlite_master spells the name CREATE TABLE "care_assignments" (quoted): that
-- is how RENAME writes it, and it is the same table.
--
-- Checks run INSIDE the transaction, before COMMIT. If one fails, the guard
-- (a throwaway TEMP table and triggers, as in 0092) rolls back the whole file
-- with a message naming the check, and nothing changes:
--   schema     each new table is the old definition plus the FOREIGN KEY
--              lines, character for character. If an earlier migration has
--              changed one of these tables, this file is stale: regenerate it.
--   copy       before the old tables are dropped: every row, rowid included,
--              is in the new table and nothing else is.
--   rows       after the rename: same row count and highest id/rowid.
--   keys       PRAGMA foreign_key_check finds nothing. A failure means a row
--              names a person who is not in pco_people. List them with
--              PRAGMA foreign_key_check(care_assignments) (and the other
--              three), then run a PCO sync to bring the person back, or delete
--              the row on purpose. Do not delete it just to get the deploy
--              through.
--   indexes    same index names and definitions as before.
--   counters   sqlite_sequence as before.
--   stats      sqlite_stat1/stat4 rows as before.
--   integrity  PRAGMA integrity_check(<table>) is ok for all four.
--
-- The file records itself in _migrations just before COMMIT. The runners
-- (deploy.yml, ensureMigrationsApplied in src/lib/db.ts) insert that row
-- again after exec returns, which needs the write lock a second time. An app
-- writer queued behind this file can take the lock in that gap, and if it held
-- it past the runner's timeout the row used to go missing: the file applied
-- but unrecorded, re-running it refused, and every later deploy and every boot
-- of the new build failed (reproduced with 0095 and one 6 s writer). The
-- runners now use INSERT OR IGNORE, so the self-recorded row is not an error.
-- A runner that still does a plain INSERT stops with "UNIQUE constraint
-- failed: _migrations.filename" after this file has applied and recorded
-- itself; run it again and it carries on from the next file.
--
-- The old code keeps serving while this runs. On the production copy the file
-- took 48 to 86 ms. The app waits up to its 10 s busy_timeout for the write
-- lock; the deploy runner waits up to 60 s for the app's. A "database is
-- locked" at BEGIN IMMEDIATE means nothing has changed. After COMMIT the file
-- is applied and recorded, so a lock error from the runner's own INSERT only
-- fails that deploy run; re-running it skips this file. Either way, re-run the
-- deploy right away: the new build and this file are already on the host
-- (deploy.yml copies them before the migrate step), and if the app restarts
-- first, getDb() applies pending migrations inside the app's own 150 MB
-- process (see 0095's header for what that costs). Old code that deletes a
-- person with owned rows, or writes one for a person missing from pco_people,
-- in the seconds before the restart gets "FOREIGN KEY constraint failed"
-- rather than a silent orphan.
PRAGMA foreign_keys = OFF;

-- IMMEDIATE, as in 0092: the guard's snapshot reads come before any write.
BEGIN IMMEDIATE;

CREATE TEMP TABLE _0094_guard (step TEXT NOT NULL);

-- What must survive the rebuild unchanged.
CREATE TEMP TABLE _0094_tables AS
  SELECT name, sql FROM sqlite_master
   WHERE type = 'table'
     AND name IN ('care_assignments', 'shepherd_known_people', 'shepherd_assignments', 'org_wide_access');
CREATE TEMP TABLE _0094_indexes AS
  SELECT name, tbl_name, sql FROM sqlite_master
   WHERE type = 'index' AND tbl_name IN (SELECT name FROM _0094_tables);
CREATE TEMP TABLE _0094_rows AS
  SELECT 'care_assignments' AS name, COUNT(*) AS n, MAX(rowid) AS top FROM care_assignments
  UNION ALL SELECT 'shepherd_known_people', COUNT(*), MAX(rowid) FROM shepherd_known_people
  UNION ALL SELECT 'shepherd_assignments', COUNT(*), MAX(rowid) FROM shepherd_assignments
  UNION ALL SELECT 'org_wide_access', COUNT(*), MAX(rowid) FROM org_wide_access;
CREATE TEMP TABLE _0094_seq AS
  SELECT name, seq FROM sqlite_sequence WHERE name IN (SELECT name FROM _0094_tables);
CREATE TEMP TABLE _0094_stat1 AS
  SELECT * FROM sqlite_stat1 WHERE tbl IN (SELECT name FROM _0094_tables);
CREATE TEMP TABLE _0094_stat4 AS
  SELECT * FROM sqlite_stat4 WHERE tbl IN (SELECT name FROM _0094_tables);

-- The key clause each table gains, exactly as written in its new definition.
CREATE TEMP TABLE _0094_added (name TEXT NOT NULL, clause TEXT NOT NULL);
INSERT INTO _0094_added (name, clause) VALUES
  ('care_assignments', ',
  FOREIGN KEY (org_id, shepherd_person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT'),
  ('shepherd_known_people', ',
  FOREIGN KEY (org_id, shepherd_person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT'),
  ('shepherd_assignments', ',
  FOREIGN KEY (org_id, shepherd_person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT'),
  ('org_wide_access', ',
  FOREIGN KEY (org_id, person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT');

-- The rebuild procedure is only safe when nothing else names these tables:
-- no view, no trigger, no other table's foreign key.
CREATE TEMP TRIGGER _0094_check_schema BEFORE INSERT ON _0094_guard
WHEN NEW.step = 'schema' AND (
  (SELECT COUNT(*) FROM _0094_tables) <> 4
  OR EXISTS (SELECT 1 FROM sqlite_master WHERE type IN ('view', 'trigger'))
  OR EXISTS (SELECT 1 FROM sqlite_master m, pragma_foreign_key_list(m.name) f
              WHERE m.type = 'table' AND f."table" IN (SELECT name FROM _0094_tables))
  OR EXISTS (
    SELECT 1 FROM _0094_tables t JOIN _0094_added a ON a.name = t.name
     WHERE replace(replace(
             (SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '_0094_' || t.name),
             'CREATE TABLE _0094_' || t.name, 'CREATE TABLE ' || t.name),
             a.clause, '') IS NOT t.sql
        OR instr((SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '_0094_' || t.name), a.clause) = 0))
BEGIN
  SELECT RAISE(ROLLBACK, '0094 refused (schema): care_assignments, shepherd_known_people, shepherd_assignments or org_wide_access is no longer the table this migration was written against, or a view, trigger or foreign key now names one. Regenerate 0094 from the current definitions. Nothing was changed.');
END;

-- The new tables: each old definition, unchanged, plus its key lines.
CREATE TABLE _0094_care_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (org_id, person_id),
  FOREIGN KEY (org_id, shepherd_person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT
);

CREATE TABLE _0094_shepherd_known_people (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'know',   -- 'know' | 'present'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, shepherd_person_id, person_id, source),
  FOREIGN KEY (org_id, shepherd_person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT
);

CREATE TABLE _0094_shepherd_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shepherd_person_id TEXT NOT NULL,
  target_kind TEXT NOT NULL
    CHECK (target_kind IN (
      'group', 'group_type', 'team', 'service_type',
      'team_position', 'person', 'membership_type',
      'shepherd_team', 'reference_list'
    )),
  target_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (org_id, shepherd_person_id, target_kind, target_id),
  FOREIGN KEY (org_id, shepherd_person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT
);

CREATE TABLE _0094_org_wide_access (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, person_id),
  FOREIGN KEY (org_id, person_id)
    REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT
);

-- Before any data moves: refuse if the tables are not what this was written for.
INSERT INTO _0094_guard (step) VALUES ('schema');
DROP TRIGGER _0094_check_schema;

-- Every row, with its id (the two AUTOINCREMENT tables) or its rowid.
INSERT INTO _0094_care_assignments (id, org_id, shepherd_person_id, person_id, note, created_at)
  SELECT id, org_id, shepherd_person_id, person_id, note, created_at FROM care_assignments;
INSERT INTO _0094_shepherd_known_people (rowid, org_id, shepherd_person_id, person_id, source, created_at)
  SELECT rowid, org_id, shepherd_person_id, person_id, source, created_at FROM shepherd_known_people;
INSERT INTO _0094_shepherd_assignments (id, org_id, shepherd_person_id, target_kind, target_id, note, created_at)
  SELECT id, org_id, shepherd_person_id, target_kind, target_id, note, created_at FROM shepherd_assignments;
INSERT INTO _0094_org_wide_access (rowid, org_id, person_id, created_at)
  SELECT rowid, org_id, person_id, created_at FROM org_wide_access;

-- Old and new hold exactly the same rows, rowid included. Dropped again before
-- the old tables go: RENAME re-parses every trigger, temp ones included, and
-- fails on one that names a table no longer there.
CREATE TEMP TRIGGER _0094_check_copy BEFORE INSERT ON _0094_guard
WHEN NEW.step = 'copy' AND (
     EXISTS (SELECT rowid, * FROM care_assignments EXCEPT SELECT rowid, * FROM _0094_care_assignments)
  OR EXISTS (SELECT rowid, * FROM _0094_care_assignments EXCEPT SELECT rowid, * FROM care_assignments)
  OR EXISTS (SELECT rowid, * FROM shepherd_known_people EXCEPT SELECT rowid, * FROM _0094_shepherd_known_people)
  OR EXISTS (SELECT rowid, * FROM _0094_shepherd_known_people EXCEPT SELECT rowid, * FROM shepherd_known_people)
  OR EXISTS (SELECT rowid, * FROM shepherd_assignments EXCEPT SELECT rowid, * FROM _0094_shepherd_assignments)
  OR EXISTS (SELECT rowid, * FROM _0094_shepherd_assignments EXCEPT SELECT rowid, * FROM shepherd_assignments)
  OR EXISTS (SELECT rowid, * FROM org_wide_access EXCEPT SELECT rowid, * FROM _0094_org_wide_access)
  OR EXISTS (SELECT rowid, * FROM _0094_org_wide_access EXCEPT SELECT rowid, * FROM org_wide_access))
BEGIN
  SELECT RAISE(ROLLBACK, '0094 refused (copy): a rebuilt table does not hold exactly the rows of the old one. Nothing was changed.');
END;
INSERT INTO _0094_guard (step) VALUES ('copy');
DROP TRIGGER _0094_check_copy;

DROP TABLE care_assignments;
DROP TABLE shepherd_known_people;
DROP TABLE shepherd_assignments;
DROP TABLE org_wide_access;

ALTER TABLE _0094_care_assignments RENAME TO care_assignments;
ALTER TABLE _0094_shepherd_known_people RENAME TO shepherd_known_people;
ALTER TABLE _0094_shepherd_assignments RENAME TO shepherd_assignments;
ALTER TABLE _0094_org_wide_access RENAME TO org_wide_access;

-- The indexes, exactly as they were (0024, 0065, 0025).
CREATE INDEX care_assignments_org_shep
  ON care_assignments(org_id, shepherd_person_id);
CREATE INDEX shepherd_known_people_person ON shepherd_known_people(org_id, person_id);
CREATE INDEX shepherd_known_people_source ON shepherd_known_people(org_id, source);
CREATE INDEX shepherd_assignments_org_shep
  ON shepherd_assignments(org_id, shepherd_person_id);
CREATE INDEX shepherd_assignments_org_target
  ON shepherd_assignments(org_id, target_kind, target_id);

-- The copy set each counter to the highest id; put back the saved values, which
-- also remember ids used by rows deleted since.
DELETE FROM sqlite_sequence WHERE name IN (SELECT name FROM _0094_tables);
INSERT INTO sqlite_sequence (name, seq) SELECT name, seq FROM _0094_seq;

-- DROP TABLE deleted the statistics; the data is identical, so the saved rows
-- are exactly as accurate as before.
DELETE FROM sqlite_stat1 WHERE tbl IN (SELECT name FROM _0094_tables);
INSERT INTO sqlite_stat1 SELECT * FROM _0094_stat1;
DELETE FROM sqlite_stat4 WHERE tbl IN (SELECT name FROM _0094_tables);
INSERT INTO sqlite_stat4 SELECT * FROM _0094_stat4;

-- The remaining checks, created only now that the tables are back in place.
CREATE TEMP TRIGGER _0094_check_rows BEFORE INSERT ON _0094_guard
WHEN NEW.step = 'rows' AND EXISTS (
  SELECT name, n, top FROM _0094_rows
  EXCEPT
  SELECT * FROM (
    SELECT 'care_assignments', COUNT(*), MAX(rowid) FROM care_assignments
    UNION ALL SELECT 'shepherd_known_people', COUNT(*), MAX(rowid) FROM shepherd_known_people
    UNION ALL SELECT 'shepherd_assignments', COUNT(*), MAX(rowid) FROM shepherd_assignments
    UNION ALL SELECT 'org_wide_access', COUNT(*), MAX(rowid) FROM org_wide_access))
BEGIN
  SELECT RAISE(ROLLBACK, '0094 refused (rows): a rebuilt table does not hold the same rows as before. Nothing was changed.');
END;

CREATE TEMP TRIGGER _0094_check_keys BEFORE INSERT ON _0094_guard
WHEN NEW.step = 'keys' AND (
     EXISTS (SELECT 1 FROM pragma_foreign_key_check('care_assignments'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('shepherd_known_people'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('shepherd_assignments'))
  OR EXISTS (SELECT 1 FROM pragma_foreign_key_check('org_wide_access')))
BEGIN
  SELECT RAISE(ROLLBACK, '0094 refused (keys): a care, known-people, shepherd-assignment or org-wide-access row names a person who is not in pco_people. See PRAGMA foreign_key_check(<table>) for each of the four. Sync the person back from PCO, or delete the row on purpose, then deploy again. Nothing was changed.');
END;

CREATE TEMP TRIGGER _0094_check_indexes BEFORE INSERT ON _0094_guard
WHEN NEW.step = 'indexes' AND (
     EXISTS (SELECT name, tbl_name, sql FROM _0094_indexes
             EXCEPT SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index')
  OR EXISTS (SELECT name, tbl_name, sql FROM sqlite_master
              WHERE type = 'index' AND tbl_name IN (SELECT name FROM _0094_tables)
             EXCEPT SELECT name, tbl_name, sql FROM _0094_indexes))
BEGIN
  SELECT RAISE(ROLLBACK, '0094 refused (indexes): the rebuilt tables do not have exactly their old indexes. Nothing was changed.');
END;

CREATE TEMP TRIGGER _0094_check_counters BEFORE INSERT ON _0094_guard
WHEN NEW.step = 'counters' AND (
     EXISTS (SELECT name, seq FROM _0094_seq EXCEPT SELECT name, seq FROM sqlite_sequence)
  OR EXISTS (SELECT name, seq FROM sqlite_sequence WHERE name IN (SELECT name FROM _0094_tables)
             EXCEPT SELECT name, seq FROM _0094_seq))
BEGIN
  SELECT RAISE(ROLLBACK, '0094 refused (counters): an AUTOINCREMENT counter moved. Nothing was changed.');
END;

CREATE TEMP TRIGGER _0094_check_stats BEFORE INSERT ON _0094_guard
WHEN NEW.step = 'stats' AND (
     EXISTS (SELECT * FROM _0094_stat1 EXCEPT SELECT * FROM sqlite_stat1)
  OR EXISTS (SELECT * FROM sqlite_stat1 WHERE tbl IN (SELECT name FROM _0094_tables) EXCEPT SELECT * FROM _0094_stat1)
  OR EXISTS (SELECT * FROM _0094_stat4 EXCEPT SELECT * FROM sqlite_stat4)
  OR EXISTS (SELECT * FROM sqlite_stat4 WHERE tbl IN (SELECT name FROM _0094_tables) EXCEPT SELECT * FROM _0094_stat4))
BEGIN
  SELECT RAISE(ROLLBACK, '0094 refused (stats): the planner statistics for the rebuilt tables changed. Nothing was changed.');
END;

CREATE TEMP TRIGGER _0094_check_integrity BEFORE INSERT ON _0094_guard
WHEN NEW.step = 'integrity' AND (
     (SELECT group_concat(integrity_check) FROM pragma_integrity_check('care_assignments')) IS NOT 'ok'
  OR (SELECT group_concat(integrity_check) FROM pragma_integrity_check('shepherd_known_people')) IS NOT 'ok'
  OR (SELECT group_concat(integrity_check) FROM pragma_integrity_check('shepherd_assignments')) IS NOT 'ok'
  OR (SELECT group_concat(integrity_check) FROM pragma_integrity_check('org_wide_access')) IS NOT 'ok')
BEGIN
  SELECT RAISE(ROLLBACK, '0094 refused (integrity): PRAGMA integrity_check reports a problem in a rebuilt table. Nothing was changed.');
END;

INSERT INTO _0094_guard (step) VALUES
  ('rows'), ('keys'), ('indexes'), ('counters'), ('stats'), ('integrity');

DROP TABLE _0094_guard;
DROP TABLE _0094_tables;
DROP TABLE _0094_indexes;
DROP TABLE _0094_rows;
DROP TABLE _0094_seq;
DROP TABLE _0094_stat1;
DROP TABLE _0094_stat4;
DROP TABLE _0094_added;

-- Recorded here so the rebuild and its record commit together (see the
-- header). The runners' own INSERT OR IGNORE afterwards is then a no-op.
INSERT OR IGNORE INTO _migrations (filename) VALUES ('0094_owned_person_keys.sql');

COMMIT;

PRAGMA foreign_keys = ON;
