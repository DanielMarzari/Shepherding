-- Retire the old vocabulary from the data itself.
--
-- 0106 changed what the screens SAY. This changes what the database holds,
-- so there is one set of words everywhere and nobody has to learn a
-- translation table to read a query.
--
--   active    -> known
--   present   -> unknown
--   inactive  -> unknown
--
-- 'present' disappears entirely. It only ever meant "pco_updated_at moved
-- inside the window" — Planning Center's own updated_at on the person
-- record, which changes whenever anything about that record changes, for
-- any reason, including a sync writing to it. It was never evidence that
-- the person did something, and the vocabulary has no band for "we are not
-- sure", so it folds into unknown with the rest of the silence.
--
-- Nothing is lost that is not recoverable: person_activity still carries
-- last_pco_updated_at, so the old present/inactive split can be recomputed
-- by anyone who ever wants it.

BEGIN IMMEDIATE;

UPDATE person_activity SET classification = 'known'   WHERE classification = 'active';
UPDATE person_activity SET classification = 'unknown' WHERE classification IN ('present','inactive');

-- org_snapshot's columns carry the same words. Rename what survives, fold
-- the two that merge, and drop the originals.
ALTER TABLE org_snapshot RENAME COLUMN active_count TO known_count;
ALTER TABLE org_snapshot RENAME COLUMN active_kids  TO known_kids;

ALTER TABLE org_snapshot ADD COLUMN unknown_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE org_snapshot ADD COLUMN unknown_kids  INTEGER NOT NULL DEFAULT 0;
UPDATE org_snapshot
   SET unknown_count = COALESCE(present_count,0) + COALESCE(inactive_count,0),
       unknown_kids  = COALESCE(present_kids,0)  + COALESCE(inactive_kids,0);

ALTER TABLE org_snapshot DROP COLUMN present_count;
ALTER TABLE org_snapshot DROP COLUMN inactive_count;
ALTER TABLE org_snapshot DROP COLUMN present_kids;
ALTER TABLE org_snapshot DROP COLUMN inactive_kids;

-- Builder pages hold the old values inside their stored SQL. Order matters:
-- rewrite the compound forms before the bare ones, or the first pass turns
-- IN ('present','inactive') into IN ('unknown','unknown').
UPDATE builder_blocks
   SET config = replace(config,
         'classification IN (''shepherded'',''active'',''present'')',
         'classification IN (''shepherded'',''known'')')
 WHERE instr(config, 'classification IN (''shepherded'',''active'',''present'')') > 0;

UPDATE builder_blocks
   SET config = replace(config,
         'classification IN (''present'',''inactive'')',
         'classification = ''unknown''')
 WHERE instr(config, 'classification IN (''present'',''inactive'')') > 0;

UPDATE builder_blocks
   SET config = replace(config,
         'classification IN (''shepherded'',''active'')',
         'classification IN (''shepherded'',''known'')')
 WHERE instr(config, 'classification IN (''shepherded'',''active'')') > 0;

UPDATE builder_blocks
   SET config = replace(
         replace(
           replace(config, 'classification=''active''',  'classification=''known'''),
           'classification = ''active''', 'classification = ''known'''),
         'classification != ''inactive''', 'classification != ''unknown''')
 WHERE instr(config, 'classification=''active''') > 0
    OR instr(config, 'classification = ''active''') > 0
    OR instr(config, 'classification != ''inactive''') > 0;

UPDATE builder_blocks
   SET config = replace(
         replace(config, 'classification=''inactive''',  'classification=''unknown'''),
         'classification = ''inactive''', 'classification = ''unknown''')
 WHERE instr(config, 'classification=''inactive''') > 0
    OR instr(config, 'classification = ''inactive''') > 0;

-- Forms the patterns above do not reach: a CASE expression that lists the
-- values, SQL's <> instead of !=, and COALESCE defaults. Found by checking
-- the result of a dry run rather than by assuming the first pass was
-- complete.
UPDATE builder_blocks
   SET config = replace(replace(replace(replace(config,
         'WHEN ''active'' THEN',    'WHEN ''known'' THEN'),
         'WHEN ''present'' THEN',   'WHEN ''unknown'' THEN'),
         'classification <> ''inactive''', 'classification <> ''unknown'''),
         'COALESCE(pa.classification,''inactive'')', 'COALESCE(pa.classification,''unknown'')')
 WHERE instr(config, 'WHEN ''active'' THEN') > 0
    OR instr(config, 'WHEN ''present'' THEN') > 0
    OR instr(config, 'classification <> ''inactive''') > 0
    OR instr(config, 'COALESCE(pa.classification,''inactive'')') > 0;

-- Same for the filter block whose options list the values by name.
UPDATE builder_blocks
   SET config = replace(replace(replace(config,
         '''active''', '''known'''),
         '''present''', '''unknown'''),
         '''inactive''', '''unknown''')
 WHERE kind = 'filter' AND instr(config, 'classification') > 0;

UPDATE builder_page_versions
   SET snapshot = replace(replace(replace(snapshot,
         'classification IN (''present'',''inactive'')', 'classification = ''unknown'''),
         'classification=''active''', 'classification=''known'''),
         'classification=''inactive''', 'classification=''unknown''')
 WHERE instr(snapshot, 'classification') > 0;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0107_retire_old_vocabulary.sql');
COMMIT;
