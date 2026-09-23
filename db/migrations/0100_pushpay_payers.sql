-- A durable record per PushPay giver, so the review queue has something to show.
--
-- WHAT WAS BROKEN. The /giving page counts pushpay_payer_summary rows with no
-- person (548 of 1,669 today, behind 2,948 of 16,574 gifts) and sends the
-- reader to /audit/pushpay to place them. That page listed pushpay_donors,
-- which was emptied on 2026-09-22 and is not coming back, so it showed nothing
-- at all. Worse, there was nothing it COULD have shown: 0087 deliberately
-- stored no identity on the gifts ("NO PII IS STORED HERE") because identity
-- then lived in pushpay_donors, so all that survived an import of an unplaceable
-- giver was an opaque Payer ID.
--
-- WHAT THIS ADDS. pushpay_payers: one row per PushPay Payer ID -- the stable
-- key the All Donors export never had. The Transactions export carries First
-- Name, Last Name, Suffix, Email and Mobile Number on every gift row, and the
-- importer already parsed them to match on and then threw them away; now they
-- are kept, per giver, encrypted the way the rest of this app keeps identity:
--   enc               AES-256-GCM JSON of name, email and phone (encryptJson),
--                     the ONLY place the plaintext exists. No plaintext column.
--   name_hash         hmac(normName)   -- suffixes dropped, the matching bucket
--   export_name_hash  hmac(exportName) -- suffix kept, "is this the same row"
--   email_hash        hmac(lowercased email)
--   phone_hash        hmac(normalized phone)
-- plus the decision: person_id, match_status (matched / manual / ambiguous /
-- unmatched), match_source, the candidate_ids offered in review, and
-- first_seen_at / last_seen_at, the imports that first and last carried them.
-- 0087's claim still holds for pushpay_transactions itself -- that table gains
-- no identity here, and this is where identity now lives.
--
-- WHY A TABLE OF ITS OWN, and not columns on pushpay_payer_summary: that one
-- is DERIVED, rebuilt whole by DELETE+INSERT from the gifts on every import and
-- every dataset removal (refreshPushpayGiving, 0098). Identity and a human's
-- match decision would be deleted by the next rebuild. In SCHEMA.md's census
-- this table is "imported by hand": the identity refills from the Transactions
-- export, and the match_status = 'manual' rows do not -- they are the one part
-- no re-upload can rebuild, so it belongs in a backup like an owned table.
--
-- WHY THE PAYER ID CHANGES THE STORY. A hand match on the All Donors list had
-- to be RECOGNISED again on every upload from a name, an email and a phone
-- (sameDonor / planHandMatches), and sometimes could not be, which is why
-- donors kept falling back into review. Keyed by Payer ID there is no guessing
-- left: the same giver is the same row, upload after upload, and a hand match
-- is simply never overwritten.
--
-- ALSO HERE.
--  * pushpay_uploads.by_payer_manual, so the upload history can count the
--    gifts a hand match placed, next to by_your_id / by_donor_match. The old
--    by_donor_manual keeps its meaning (a hand match carried from the All
--    Donors list) and stays at 0 while that table is empty.
--  * Dan's word is "givers", so the giving page's stored blocks say so:
--    "Unlinked payers" becomes "Unlinked givers", and the two blocks whose
--    axis said "Payers" now say "Giver profiles" -- the distinction is real
--    (one household can hold two profiles) and the wording keeps it without
--    using PushPay's word for it. The same text is in the seed template
--    (builder-seeds.ts, revision 5), so a re-seeded page and a rewritten one
--    agree; the giving page in production is hand-edited, so the rewrite below
--    is what it will actually show. The stat's subtitle no longer promises a
--    queue that cannot list anyone yet: identity exists only for givers an
--    import running this code has seen, so before the next upload the queue is
--    honestly empty and both the stat and the page say what to do about it.
--    The MIR Finance page counts the same ids and is one click away, so its
--    seven blocks are rewritten here too rather than left reading "payers"
--    next to a page that now says "givers"; where the text is explaining what
--    PushPay's key IS, "PushPay payer ids" stays, because that is PushPay's
--    word for it and the sentence exists to say the key is not a person.
--
-- NOT BACKFILLED, ON PURPOSE. Nothing in the database can reconstruct a name
-- for the 548 unplaced givers -- that is the bug. A row written here with no
-- identity would count as "reviewed" on a page that could not show it, which
-- is exactly the false promise this file exists to remove. The table starts
-- empty and the first Transactions import fills it (an upsert, so re-uploading
-- the file already loaded is safe and simply fills in the identities).
--
-- THE DEPLOY WINDOW. The old code keeps serving between this file and the pm2
-- restart. Nothing is renamed or dropped, so it cannot fail with "no such
-- table"; an import it runs in those seconds writes gifts without identity,
-- and the next import adopts those givers normally. The rewritten blocks are
-- read from the database, so the old code renders them correctly.
--
-- Measured on the 2026-09-22 production copy: creates 1 table and 2 indexes,
-- adds 1 column, rewrites 10 builder blocks (3 on /giving, 7 on MIR Finance),
-- 13 ms. Undo snapshots are left
-- alone deliberately -- they hold the old titles, and restoring an older title
-- restores a label, not a query against a table that is not there.
--
-- Every other statement here is a no-op on a second pass (IF NOT EXISTS, and a
-- rewrite that matches only the old wording), but the ALTER TABLE is not:
-- SQLite has no ADD COLUMN IF NOT EXISTS, so re-running the file fails with
-- "duplicate column name". That is the usual shape for a column migration
-- (SCHEMA.md 5.8) and is safe because the wrapper below records the file
-- INSIDE the transaction: it is applied exactly once, or not at all.
--
-- IMMEDIATE because the guard reads before anything writes; the file records
-- itself in _migrations just before COMMIT so the change and its record commit
-- together (0094's header explains why).
BEGIN IMMEDIATE;

-- One row per PushPay Payer ID. A gift whose export row carried no Payer ID is
-- its own giver, keyed 'tx:<transaction id>' -- the same key
-- pushpay_payer_summary is built with, so the two join one to one.
--
-- person_id carries a foreign key ON DELETE RESTRICT (the 0094 pattern) because
-- people type rows in here: a hand match must not be left pointing at a person
-- who has been deleted. The junk-name filter is the only code that deletes from
-- pco_people, and HAS_OWNED_DATA_SQL now spares anyone this table names, so the
-- restriction should never fire -- it is there for the case nobody thought of.
CREATE TABLE IF NOT EXISTS pushpay_payers (
  org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payer_id         TEXT NOT NULL,
  enc              TEXT,             -- encryptJson({firstName,lastName,email,phone})
  name_hash        TEXT,             -- hmac(normName): suffixes dropped
  export_name_hash TEXT,             -- hmac(exportName): suffix kept
  email_hash       TEXT,
  phone_hash       TEXT,
  your_id          TEXT,             -- the export's "Your ID" cell: a pco_id, ours, not PII
  person_id        TEXT,
  match_status     TEXT NOT NULL DEFAULT 'unmatched',  -- matched | manual | ambiguous | unmatched
  match_source     TEXT,             -- your_id | payer_manual | donor_manual | donor_match | unmatched
  candidate_ids    TEXT,             -- JSON array of pco_ids offered in review
  first_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, payer_id),
  FOREIGN KEY (org_id, person_id) REFERENCES pco_people(org_id, pco_id) ON DELETE RESTRICT
);
-- The review queue reads one status at a time and counts all four.
CREATE INDEX IF NOT EXISTS pushpay_payers_status ON pushpay_payers(org_id, match_status);
-- "which givers is this person" -- the person page and the unassign path.
CREATE INDEX IF NOT EXISTS pushpay_payers_person ON pushpay_payers(org_id, person_id);

CREATE TEMP TABLE _0100_guard (step TEXT NOT NULL);

-- The table has to be the one this file describes. If a name like this was
-- created out of band with a different shape, CREATE TABLE IF NOT EXISTS would
-- silently keep it and every insert below would fail somewhere later.
CREATE TEMP TRIGGER _0100_refuse_shape BEFORE INSERT ON _0100_guard
WHEN NEW.step = 'shape' AND NOT EXISTS (
  SELECT 1 FROM sqlite_master
   WHERE type = 'table' AND name = 'pushpay_payers'
     AND instr(sql, 'export_name_hash') > 0
     AND instr(sql, 'candidate_ids') > 0
     AND instr(sql, 'first_seen_at') > 0
     AND instr(sql, 'last_seen_at') > 0)
BEGIN
  SELECT RAISE(ROLLBACK, '0100 refused (shape): a pushpay_payers table already exists with a different shape -- it was created outside a migration. Reconcile it by hand, then deploy again. Nothing was changed.');
END;

INSERT INTO _0100_guard (step) VALUES ('shape');
DROP TRIGGER _0100_refuse_shape;
DROP TABLE _0100_guard;

-- Gifts placed by a hand match on the giver, counted apart from the three
-- sources 0098 already recorded. Nullable-with-default, so the old code serving
-- during the deploy window keeps inserting upload rows without it.
ALTER TABLE pushpay_uploads ADD COLUMN by_payer_manual INTEGER NOT NULL DEFAULT 0;

-- ── The giving page says "givers" ──────────────────────────────────────────
-- Matched by (slug, kind, title) and only where the old wording is still
-- there, so a second pass changes nothing. No refusal if a block has been
-- retitled by hand: nothing here changes what a query NAMES, so a block this
-- misses keeps working and only keeps the old label -- not worth wedging a
-- deploy over. json_set touches $.title / $.sub alone and replace() touches
-- one column label, so a hand-restyled block (the Giving pattern chart is a
-- population pyramid in production) keeps its styling.

UPDATE builder_blocks
   SET config = json_set(config,
         '$.title', 'Unlinked givers',
         '$.sub', 'PushPay giver profiles with no person attached — a household can hold two. They can be placed by hand on Audit › PushPay connections once an import has stored their names; until then that queue is empty and says so.')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'stat'
   AND json_extract(config, '$.title') = 'Unlinked payers';

UPDATE builder_blocks
   SET config = replace(config, 'AS \"Payers\"', 'AS \"Giver profiles\"')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'chart'
   AND json_extract(config, '$.title') = 'Giving pattern'
   AND instr(config, 'AS \"Payers\"') > 0;

UPDATE builder_blocks
   SET config = json_set(
         replace(config, 'AS \"Payers giving\"', 'AS \"Giver profiles giving\"'),
         '$.sub', 'every gift by the date PushPay recorded it, and how many giver profiles are behind them — cash and cheques are keyed in afterwards, so their month can lag the Sunday')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'chart'
   AND json_extract(config, '$.title') = 'Gifts and givers by month'
   AND instr(config, 'AS \"Payers giving\"') > 0;

-- ── MIR Finance says "givers" too ─────────────────────────────────────────
-- The same rename, on the other page that counts PushPay payer ids. It is one
-- click from /giving, so leaving it saying "payers" would have made the rename
-- read like a slip rather than a decision. Same shape as above: json_set on
-- $.title / $.sub, replace() on the column label and on the sentences inside
-- the explainer, each matched only where the old wording is still there, so a
-- second pass changes nothing and a block someone has retitled by hand is left
-- alone. "PushPay payer ids" survives on purpose where the text is explaining
-- what the id IS -- that is PushPay's word for their own key, and the whole
-- point of the paragraph is that the key is not a person.
--
-- The column label goes first: the title matches below would miss a chart whose
-- title this same migration had already changed.
UPDATE builder_blocks
   SET config = replace(config, 'AS \"Payers\"', 'AS \"Giver profiles\"')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'chart'
   AND instr(config, 'AS \"Payers\"') > 0;

UPDATE builder_blocks
   SET config = json_set(config,
         '$.title', 'Giver profiles on record',
         '$.sub', 'PushPay giver profiles with a gift in the window, whether or not we can name the person behind them')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'stat'
   AND json_extract(config, '$.title') = 'Payers on record';

UPDATE builder_blocks
   SET config = json_set(config, '$.sub', 'giver profiles with a gift in the last 90 days of the window')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'stat'
   AND json_extract(config, '$.title') = 'Gave in the last 90 days'
   AND json_extract(config, '$.sub') = 'payers with a gift in the last 90 days of the window';

UPDATE builder_blocks
   SET config = json_set(config,
         '$.title', 'Giver profiles giving on a schedule',
         '$.sub', 'giver profiles with at least one Recurring gift - a schedule set up in advance, which cannot respond to a given Sunday. Giver profiles, not people: the /giving page counts the same schedules per person and reads lower')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'stat'
   AND json_extract(config, '$.title') = 'Payers giving on a schedule';

UPDATE builder_blocks
   SET config = json_set(config,
         '$.title', 'How givers give',
         '$.sub', 'giver profiles with a gift in the last 90 days of the window, by method - PushPay profiles, so a household with two of them counts twice')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'chart'
   AND json_extract(config, '$.title') = 'How payers give';

UPDATE builder_blocks
   SET config = json_set(config,
         '$.title', 'How givers give, whole window',
         '$.sub', 'every giver profile with a gift anywhere in the window, by method - these total the Giver profiles on record above, not the people behind them')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'chart'
   AND json_extract(config, '$.title') = 'How payers give, whole window';

-- The explainer block: five sentences, replaced one at a time so the rest of
-- the text (and any hand edit to it) is untouched.
UPDATE builder_blocks
   SET config = replace(
         replace(
           replace(
             replace(
               replace(config,
                 'belong to payers with no id on their PushPay record',
                 'belong to giver profiles with no id on their PushPay record'),
               'the payer rollup behind the people-level blocks',
               'the giver rollup behind the people-level blocks'),
             '**A payer is not a person.** Blocks titled “payers” count PushPay payer ids',
             '**A giver profile is not a person.** Blocks titled “giver profiles” count PushPay payer ids'),
           'The gap is the 548 payers with no “Your ID”',
           'The gap is the 548 giver profiles with no “Your ID”'),
         'Counting every payer including the unlinked',
         'Counting every giver profile including the unlinked')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'text'
   AND instr(config, 'A payer is not a person') > 0;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0100_pushpay_payers.sql');
COMMIT;
