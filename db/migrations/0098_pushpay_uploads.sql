-- PushPay uploads: a record of every file, a way to take one back out, and the
-- per-giver rollup the giving pages will read.
--
-- WHAT WAS MISSING. pushpay_import holds ONE row per org, overwritten by each
-- upload of either kind. It answers "what did the last upload do" and nothing
-- else: not which file brought which gifts, and so not how to remove a file
-- that should not have been loaded. pushpay_transactions upserts by
-- transaction_id, so every export window adds history and nothing ever leaves.
-- Dan asked to keep uploading new datasets AND to be able to remove old ones,
-- which needs a record of what each upload put in.
--
--   pushpay_uploads              one row per upload, of either kind
--   pushpay_transaction_uploads  which uploads supplied which gift (many-many)
--   pushpay_transactions         + first_upload_id, last_upload_id (value provenance)
--   pushpay_payer_summary        one row per payer, rebuilt from the gifts
--   pushpay_giving_snapshot      one row per org: totals + the rollup's watermark
--
-- WHICH UPLOADS SUPPLIED A GIFT: pushpay_transaction_uploads, one row per
-- (gift, upload that carried it). PushPay export windows overlap — the same
-- September gift is in the August-to-September file and in the
-- January-to-September one — so "which file is this gift in" is a many-to-many
-- fact and cannot be squeezed into two columns on the gift. Two columns were
-- tried first and lost data: with C1 ⊂ C2 ⊂ C3 all holding gift x, removing C1
-- and then C3 deleted x while C2, which also carried it, was still in the list.
-- A supply row is written by importPushpayTransactions for EVERY row of the
-- file, re-supply included, so a gift is removable exactly while some file that
-- carried it is still here.
--
-- VALUE PROVENANCE, two columns on the gift, a different question:
-- first_upload_id is the upload that inserted the row and never changes;
-- last_upload_id is the upload that last WROTE its person, source and fund, and
-- moves on every re-supply. They say where the values came from, never whether
-- the gift may be deleted — that is the supply table's job alone. When the
-- upload one of them names is removed, the column goes NULL: the file that
-- wrote these values is no longer here, and nothing pretends another file did.
--
-- REMOVAL SEMANTICS, the part to read twice. Removing an upload deletes the
-- gifts it supplied that NO other upload still supplies. A gift another file
-- also carried STAYS, because that file is still here and still says the gift
-- happened — whether that file is older or newer makes no difference. A gift
-- that stays keeps the values it holds now, which are the ones last_upload_id
-- names: if THIS upload wrote them they survive it, because we keep no
-- per-upload versions of a row and there is nothing to roll back to. The UI
-- counts those separately and says so before it asks. Once every upload that
-- supplied a gift has been removed, the gift goes, because nothing left says it
-- happened.
--
-- Removing an All Donors upload empties pushpay_donors instead: that import
-- replaces the whole set, so the set is the upload.
--
-- NO AMOUNTS. PushPay's Transactions export carries no amount and neither does
-- anything here. Nothing in this schema may imply money.
--
-- AUTOINCREMENT, deliberately. With a plain INTEGER PRIMARY KEY SQLite hands
-- the highest deleted id to the next row, so any reference that outlived its
-- upload — a hand edit, a row written by the old code mid-deploy — would be
-- silently adopted by an upload that never saw the gift. Ids that are never
-- reused make "this id means that upload" true forever.
--
-- THE DEPLOY WINDOW (rule 3 in db/SCHEMA.md §5). Old code keeps serving for a
-- few seconds after this runs. Every column added here is nullable and the
-- supply table is new, so the old importer keeps working; the gifts it writes
-- in those seconds have no supply row, belong to no upload, and no Remove will
-- delete them — a removal only ever deletes gifts the upload it is removing
-- supplied, so they are never swept up by someone else's removal either.
-- Re-uploading that file adopts them: the supply row is written for every row
-- of the file, not only for inserts. `SELECT COUNT(*) FROM pushpay_transactions
-- t WHERE NOT EXISTS (SELECT 1 FROM pushpay_transaction_uploads l WHERE
-- l.org_id = t.org_id AND l.transaction_id = t.transaction_id)` finds them.
-- The old code also never rebuilds pushpay_payer_summary; the cron's
-- isPushpayGivingStale backstop catches that within 15 minutes.
--
-- PEOPLE. pushpay_payer_summary.person_id is a pco_people.pco_id, like every
-- other person_id (§1), and carries no foreign key — it is derived, rebuilt
-- whole from pushpay_transactions, which has no key either. It needs no entry
-- in PERSON_ROW_DELETES: the junk-name filter never deletes anyone with a
-- pushpay_transactions row (HAS_OWNED_DATA_SQL in pco-sync.ts), so no payer
-- row can be left naming a deleted person.
--
-- TIMINGS. There is no production copy to measure on here, so the numbers that
-- usually sit in this header are missing. What is known: production holds
-- 16,574 gifts from 1,668 payers spanning 2026-01-01..2026-09-16, all from one
-- import, so the backfill below writes one pushpay_uploads row, one supply row
-- per gift (16,574) and stamps the same 16,574 rows, and the rollup below
-- groups them into 1,668.

BEGIN IMMEDIATE;

-- One row per upload of either PushPay export. Newest first is the list the
-- /pushpay page shows.
--
-- total      rows the file had (gifts, or donors)
-- inserted   of those, rows that were new to us. For transactions this is the
--            genuine insert count, measured as the row count before and after
--            the upsert; an ON CONFLICT DO UPDATE reports one change either
--            way, so it cannot be counted from the statement's result. For
--            donors the import replaces the whole set, so it equals total.
-- matched / ambiguous / unmatched  the match breakdown. Donors use all three;
--            transactions have no ambiguous state (a payer is resolved or it
--            is not), so theirs is always 0.
-- by_your_id / by_donor_manual / by_donor_match  transactions only: which of
--            the three routes in importPushpayTransactions resolved each gift.
--            They add up to matched.
-- first_gift_on / last_gift_on  transactions only: the earliest and latest
--            gift date in the file.
-- is_backfilled  1 on the synthetic row the backfill below writes for gifts
--            that were already here when this table was created.
CREATE TABLE IF NOT EXISTS pushpay_uploads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,   -- 'donors' (All Donors) | 'transactions'
  file_name       TEXT,
  imported_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  total           INTEGER NOT NULL DEFAULT 0,
  inserted        INTEGER NOT NULL DEFAULT 0,
  matched         INTEGER NOT NULL DEFAULT 0,
  ambiguous       INTEGER NOT NULL DEFAULT 0,
  unmatched       INTEGER NOT NULL DEFAULT 0,
  by_your_id      INTEGER NOT NULL DEFAULT 0,
  by_donor_manual INTEGER NOT NULL DEFAULT 0,
  by_donor_match  INTEGER NOT NULL DEFAULT 0,
  first_gift_on   TEXT,
  last_gift_on    TEXT,
  is_backfilled   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pushpay_uploads_org ON pushpay_uploads(org_id, imported_at DESC);

-- One row per (gift, upload that carried it): the whole answer to "may this
-- gift be deleted when that file goes". Export windows overlap, so a gift has
-- as many rows here as files that listed it. WITHOUT ROWID because the table
-- IS its primary key and nothing else points at it; the secondary index is the
-- per-upload direction, used by the removal, the per-upload counts on
-- /pushpay, and nothing else.
CREATE TABLE IF NOT EXISTS pushpay_transaction_uploads (
  org_id         INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  upload_id      INTEGER NOT NULL REFERENCES pushpay_uploads(id) ON DELETE CASCADE,
  PRIMARY KEY (org_id, transaction_id, upload_id),
  FOREIGN KEY (org_id, transaction_id)
    REFERENCES pushpay_transactions(org_id, transaction_id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS pushpay_tx_uploads_by_upload
  ON pushpay_transaction_uploads(org_id, upload_id);

ALTER TABLE pushpay_transactions ADD COLUMN first_upload_id INTEGER;
ALTER TABLE pushpay_transactions ADD COLUMN last_upload_id INTEGER;

-- Value provenance, read two ways: the counts the confirmation shows (how many
-- surviving gifts still hold the values this file wrote) and the two UPDATEs a
-- removal runs to blank the columns that named it, which would otherwise scan
-- the org.
CREATE INDEX IF NOT EXISTS pushpay_tx_upload ON pushpay_transactions(org_id, first_upload_id, last_upload_id);
-- The rollup's staleness watermark, read by the cron every 15 minutes:
-- COUNT(*) and MAX(imported_at) for the org, both covered by this index, so
-- the check never touches the table itself.
CREATE INDEX IF NOT EXISTS pushpay_tx_imported ON pushpay_transactions(org_id, imported_at);

-- One row per payer per org, rebuilt whole from pushpay_transactions by
-- refreshPushpayGiving() at the end of every transactions import and every
-- dataset removal. The giving pages read this instead of re-grouping 16k gifts
-- per render, the way constant_contact_engagement stands in front of
-- constant_contact_activity (0091).
--
-- payer_id   PushPay's stable donor key, the one thing the All Donors export
--            never had. A gift whose export row carried no Payer ID is its own
--            payer, keyed 'tx:<transaction id>' — the same key
--            importPushpayTransactions decides that gift's match under.
-- person_id  the pco_people.pco_id the payer resolves to. A payer's gifts can
--            disagree (an older file matched them to nobody, or to someone
--            else, and a newer file did not re-supply those gifts), so this is
--            the person named by the payer's most recently imported gift that
--            names anyone.
-- is_linked  person_id IS NOT NULL, as a column: the pages count linked
--            against unlinked payers, and SUM(is_linked) in stored builder SQL
--            is harder to get wrong than a NULL test inside an aggregate.
-- recurring_gifts / other_gifts  gifts whose source is exactly 'Recurring',
--            and all the rest (Batch Entry, Web, Text Giving, Mobile, Kiosk,
--            and gifts with no source at all). They add up to gifts.
-- funds      a JSON array of the distinct fund names the payer has given to,
--            sorted; '[]' when every gift of theirs named no fund.
-- NEVER an amount: the export has none.
CREATE TABLE IF NOT EXISTS pushpay_payer_summary (
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payer_id        TEXT NOT NULL,
  person_id       TEXT,
  is_linked       INTEGER NOT NULL DEFAULT 0,
  first_gift_on   TEXT NOT NULL,
  last_gift_on    TEXT NOT NULL,
  gifts           INTEGER NOT NULL,
  recurring_gifts INTEGER NOT NULL,
  other_gifts     INTEGER NOT NULL,
  funds           TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (org_id, payer_id)
);
CREATE INDEX IF NOT EXISTS pushpay_payer_summary_person ON pushpay_payer_summary(org_id, person_id);

-- One row per org, written by the same rebuild, so "built, and empty" is
-- distinguishable from "never built".
--
-- source_rows / source_written_at are the watermark: COUNT(*) and
-- MAX(imported_at) over the org's pushpay_transactions, read inside the
-- rebuild's transaction. isPushpayGivingStale() compares them again. The
-- import and the removal both rebuild INSIDE their own transaction, so the
-- rollup cannot be left behind by a half-finished one; the watermark is for
-- the old code during a deploy window, and for anything that ever edits
-- pushpay_transactions by hand.
CREATE TABLE IF NOT EXISTS pushpay_giving_snapshot (
  org_id            INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  payers            INTEGER NOT NULL,
  linked_payers     INTEGER NOT NULL,
  gifts             INTEGER NOT NULL,
  first_gift_on     TEXT,
  last_gift_on      TEXT,
  source_rows       INTEGER NOT NULL,
  source_written_at TEXT,
  built_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Backfill: the gifts that were here before this table ────────────────────
--
-- One synthetic upload per org standing for every gift already imported, so
-- those gifts belong to something and can be removed like any other dataset.
-- Its imported_at is the earliest imported_at of the rows themselves, and its
-- file name is the one pushpay_import kept IF that row describes a
-- transactions upload (an All Donors upload used to leave kind alone, so a
-- 'donors' or NULL kind there says nothing about these gifts, and the name is
-- left NULL rather than guessed).
--
-- first_gift_on / last_gift_on are MIN/MAX of the gifts' own received_on: what
-- we hold, measured, not a file's span we never recorded and not the import
-- date wearing a gift date's name. The match breakdown is likewise recounted
-- from match_source rather than copied from pushpay_import, whose counts a
-- later All Donors upload or a Re-match may have overwritten.
INSERT INTO pushpay_uploads
  (org_id, kind, file_name, imported_at, total, inserted,
   matched, ambiguous, unmatched, by_your_id, by_donor_manual, by_donor_match,
   first_gift_on, last_gift_on, is_backfilled)
SELECT t.org_id, 'transactions',
       (SELECT i.file_name FROM pushpay_import i
         WHERE i.org_id = t.org_id AND i.kind = 'transactions'),
       MIN(t.imported_at), COUNT(*), COUNT(*),
       SUM(COALESCE(t.match_source, 'unmatched') <> 'unmatched'), 0,
       SUM(COALESCE(t.match_source, 'unmatched') =  'unmatched'),
       SUM(t.match_source = 'your_id'),
       SUM(t.match_source = 'donor_manual'),
       SUM(t.match_source = 'donor_match'),
       MIN(t.received_on), MAX(t.received_on), 1
  FROM pushpay_transactions t
 WHERE t.first_upload_id IS NULL
 GROUP BY t.org_id;

UPDATE pushpay_transactions
   SET first_upload_id = (SELECT u.id FROM pushpay_uploads u
                           WHERE u.org_id = pushpay_transactions.org_id AND u.is_backfilled = 1),
       last_upload_id  = (SELECT u.id FROM pushpay_uploads u
                           WHERE u.org_id = pushpay_transactions.org_id AND u.is_backfilled = 1)
 WHERE first_upload_id IS NULL;

-- Every existing gift was supplied by that one synthetic upload, so it is the
-- only file standing between them and deletion: removing it removes them all.
INSERT OR IGNORE INTO pushpay_transaction_uploads (org_id, transaction_id, upload_id)
SELECT t.org_id, t.transaction_id, u.id
  FROM pushpay_transactions t
  JOIN pushpay_uploads u ON u.org_id = t.org_id AND u.is_backfilled = 1;

-- ── First build of the rollup ───────────────────────────────────────────────
--
-- The same SQL as refreshPushpayGiving() in src/lib/pushpay-import.ts, over
-- every org at once instead of one — keep the two in step, as 0091 does for
-- the Constant Contact rollups. Building it here rather than waiting for the
-- cron means the tables are right the moment the deploy finishes.
INSERT INTO pushpay_payer_summary
  (org_id, payer_id, person_id, is_linked, first_gift_on, last_gift_on,
   gifts, recurring_gifts, other_gifts, funds)
WITH g AS (
  SELECT org_id, COALESCE(payer_id, 'tx:' || transaction_id) AS pk,
         transaction_id, person_id, received_on, source, fund_name, imported_at
    FROM pushpay_transactions
),
link AS (
  SELECT org_id, pk, person_id FROM (
    SELECT org_id, pk, person_id,
           ROW_NUMBER() OVER (PARTITION BY org_id, pk
                              ORDER BY (person_id IS NULL), imported_at DESC, transaction_id DESC) AS rn
      FROM g)
   WHERE rn = 1
),
fund AS (
  SELECT org_id, pk, json_group_array(fund_name) AS funds
    FROM (SELECT DISTINCT org_id, pk, fund_name FROM g
           WHERE fund_name IS NOT NULL AND fund_name <> ''
           ORDER BY org_id, pk, fund_name)
   GROUP BY org_id, pk
)
SELECT g.org_id, g.pk, l.person_id,
       CASE WHEN l.person_id IS NULL THEN 0 ELSE 1 END,
       MIN(g.received_on), MAX(g.received_on), COUNT(*),
       SUM(CASE WHEN g.source = 'Recurring' THEN 1 ELSE 0 END),
       SUM(CASE WHEN g.source = 'Recurring' THEN 0 ELSE 1 END),
       COALESCE(f.funds, '[]')
  FROM g
  JOIN link l ON l.org_id = g.org_id AND l.pk = g.pk
  LEFT JOIN fund f ON f.org_id = g.org_id AND f.pk = g.pk
 GROUP BY g.org_id, g.pk;

INSERT INTO pushpay_giving_snapshot
  (org_id, payers, linked_payers, gifts, first_gift_on, last_gift_on, source_rows, source_written_at)
SELECT s.org_id, COUNT(*), SUM(s.is_linked), SUM(s.gifts),
       MIN(s.first_gift_on), MAX(s.last_gift_on),
       (SELECT COUNT(*) FROM pushpay_transactions t WHERE t.org_id = s.org_id),
       (SELECT MAX(t.imported_at) FROM pushpay_transactions t WHERE t.org_id = s.org_id)
  FROM pushpay_payer_summary s
 GROUP BY s.org_id;

-- Guard: every gift now has an upload that supplied it (so it can be removed)
-- and an upload that wrote its values, and the rollup counts every gift exactly
-- once. SQLite has no ASSERT, so the check is a TEMP table whose BEFORE INSERT
-- trigger rolls the whole file back (§5.2).
CREATE TEMP TABLE _0098_check (what TEXT, n INTEGER);
CREATE TEMP TRIGGER _0098_refuse BEFORE INSERT ON _0098_check WHEN NEW.n <> 0
BEGIN
  SELECT RAISE(ROLLBACK, '0098 refused: gifts with no upload, or a rollup that does not count every gift. Nothing was changed.');
END;
INSERT INTO _0098_check
SELECT 'unstamped', COUNT(*) FROM pushpay_transactions
 WHERE first_upload_id IS NULL OR last_upload_id IS NULL;
INSERT INTO _0098_check
SELECT 'unsupplied', COUNT(*) FROM pushpay_transactions t
 WHERE NOT EXISTS (SELECT 1 FROM pushpay_transaction_uploads l
                    WHERE l.org_id = t.org_id AND l.transaction_id = t.transaction_id);
INSERT INTO _0098_check
SELECT 'rollup', (SELECT COUNT(*) FROM pushpay_transactions)
               - (SELECT COALESCE(SUM(gifts), 0) FROM pushpay_payer_summary);

DROP TRIGGER _0098_refuse;
DROP TABLE _0098_check;

-- Heal the one-row "last import" summary from the upload we just recorded.
-- Production's row reads 0 gifts / 0 matched / 0 unmatched for a 16,574-gift
-- file: the counts were overwritten by a later donor re-match, and the /pushpay
-- card shows them. Every import and every removal now rewrites this row from
-- the newest upload; this brings the existing row into line so the card is not
-- wrong until the next upload.
UPDATE pushpay_import
   SET file_name   = (SELECT u.file_name FROM pushpay_uploads u WHERE u.org_id = pushpay_import.org_id ORDER BY u.imported_at DESC, u.id DESC LIMIT 1),
       total       = (SELECT u.total FROM pushpay_uploads u WHERE u.org_id = pushpay_import.org_id ORDER BY u.imported_at DESC, u.id DESC LIMIT 1),
       matched     = (SELECT u.matched FROM pushpay_uploads u WHERE u.org_id = pushpay_import.org_id ORDER BY u.imported_at DESC, u.id DESC LIMIT 1),
       ambiguous   = (SELECT u.ambiguous FROM pushpay_uploads u WHERE u.org_id = pushpay_import.org_id ORDER BY u.imported_at DESC, u.id DESC LIMIT 1),
       unmatched   = (SELECT u.unmatched FROM pushpay_uploads u WHERE u.org_id = pushpay_import.org_id ORDER BY u.imported_at DESC, u.id DESC LIMIT 1),
       imported_at = (SELECT u.imported_at FROM pushpay_uploads u WHERE u.org_id = pushpay_import.org_id ORDER BY u.imported_at DESC, u.id DESC LIMIT 1),
       kind        = (SELECT u.kind FROM pushpay_uploads u WHERE u.org_id = pushpay_import.org_id ORDER BY u.imported_at DESC, u.id DESC LIMIT 1)
 WHERE EXISTS (SELECT 1 FROM pushpay_uploads u WHERE u.org_id = pushpay_import.org_id);

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0098_pushpay_uploads.sql');
COMMIT;

-- Full statistics, never sampled (§5.7): every index here leads with org_id,
-- which has one value, so a sample would cost a per-payer lookup at the price
-- of a scan.
PRAGMA analysis_limit = 0;
ANALYZE pushpay_uploads;
ANALYZE pushpay_transaction_uploads;
ANALYZE pushpay_payer_summary;
ANALYZE pushpay_giving_snapshot;
ANALYZE pushpay_transactions;
