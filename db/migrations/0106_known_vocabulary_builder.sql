-- The Shepherded / Known / Unknown vocabulary, applied to the stored
-- builder pages.
--
-- Seed pages are copied into builder_blocks when a page is first created,
-- so editing builder-seeds.ts changes nothing that already exists. Five
-- blocks on two pages (home, people) still carry the old words. Rewriting
-- both sides keeps a re-seed a no-op, which is the rule in db/SCHEMA.md.
--
-- The mapping:
--   "Active"              -> "Known"     (same SQL; classification='active')
--   "Present"             -> "Unknown"   (SQL widened to present + inactive)
--   "Inactive"            -> removed     (its count now lives in Unknown)
--
-- Matching on the exact stored config rather than on title alone: a title
-- is a string somebody may have edited, and this should touch only blocks
-- that are still the untouched seed. A customised card keeps whatever its
-- owner made it — the cost is that it keeps the old word, which is the
-- right way round.

BEGIN IMMEDIATE;

-- home · "Active" -> "Known"
UPDATE builder_blocks
   SET config = replace(
         replace(config, '"title":"Active"', '"title":"Known"'),
         '"sub":"engaging, not yet shepherded"', '"sub":"active, not on a roster"')
 WHERE kind = 'stat'
   AND instr(config, '"title":"Active"') > 0
   AND instr(config, 'classification=''active''') > 0;

-- "Present" -> "Unknown", counting both halves of the band
UPDATE builder_blocks
   SET config = replace(
         replace(
           replace(config, '"title":"Present"', '"title":"Unknown"'),
           'classification=''present''', 'classification IN (''present'',''inactive'')'),
         '"sub":"on the books, no measured engagement"', '"sub":"nothing in the window"')
 WHERE kind = 'stat'
   AND instr(config, '"title":"Present"') > 0
   AND instr(config, 'classification=''present''') > 0;

-- The old "Inactive" card is now double-counted by Unknown, so it goes.
DELETE FROM builder_blocks
 WHERE kind = 'stat'
   AND instr(config, '"title":"Inactive"') > 0
   AND instr(config, 'classification=''inactive''') > 0;

-- "Engaged people" counted present as engaged. A staff edit to somebody's
-- record is not engagement; the vocabulary calls that Unknown.
UPDATE builder_blocks
   SET config = replace(
         replace(config,
           'classification IN (''shepherded'',''active'',''present'')',
           'classification IN (''shepherded'',''active'')'),
         '"sub":"adults, shepherded / active / present"', '"sub":"adults, Shepherded or Known"')
 WHERE instr(config, 'classification IN (''shepherded'',''active'',''present'')') > 0;

-- Same for "Unshepherded", whose label now says Known.
UPDATE builder_blocks
   SET config = replace(
         replace(config,
           'classification IN (''active'',''present'')',
           'classification = ''active'''),
         '"sub":"active + present adults"', '"sub":"Known adults, no roster"')
 WHERE instr(config, 'classification IN (''active'',''present'')') > 0;

-- The people page is down from four stat cards to three. At span 3 each
-- they would fill nine of twelve columns and leave a quarter-row of dead
-- space, so widen the row to thirds.
UPDATE builder_blocks
   SET config = replace(config, '"span":3', '"span":4')
 WHERE kind = 'stat'
   AND page_id IN (SELECT id FROM builder_pages WHERE slug = 'people')
   AND (instr(config, '"title":"Shepherded"') > 0
     OR instr(config, '"title":"Known"') > 0
     OR instr(config, '"title":"Unknown"') > 0);

-- Saved versions are rewritten the same way, or restoring one would put the
-- old words back. There are none today, which is why this is cheap — but
-- leaving it out would be a trap for the first person who ever restores.
UPDATE builder_page_versions
   SET snapshot = replace(
         replace(snapshot, '"title":"Active"', '"title":"Known"'),
         '"title":"Present"', '"title":"Unknown"')
 WHERE instr(snapshot, '"title":"Active"') > 0
    OR instr(snapshot, '"title":"Present"') > 0;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0106_known_vocabulary_builder.sql');
COMMIT;
