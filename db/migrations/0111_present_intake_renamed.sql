-- The intake page that was /present is now /know/unknown.
--
-- 'present' left the vocabulary in 0107: it only ever meant "Planning
-- Center's updated_at on the record moved", which is not evidence the person
-- did anything, so that band folded into Unknown. The invite-only intake page
-- for it kept the word in its URL, its code and in this column.
--
-- The 478 marks written through that page are real — five people's answers
-- about who they know — so they are renamed, not dropped. Idempotent.

BEGIN IMMEDIATE;

UPDATE shepherd_known_people
   SET source = 'unknown'
 WHERE source = 'present';

-- A builder page's stored filter can carry the pool as a value. None do today
-- on production; this covers a database where the seeded page was created
-- before this rename.
UPDATE builder_blocks
   SET config = replace(config, '''present'', ''Unknown pool''', '''unknown'', ''Unknown pool''')
 WHERE instr(config, '''present'', ''Unknown pool''') > 0;

INSERT OR IGNORE INTO _migrations (filename)
VALUES ('0111_present_intake_renamed.sql');
COMMIT;
