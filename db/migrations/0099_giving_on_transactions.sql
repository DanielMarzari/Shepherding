-- Giving surfaces move from the emptied All Donors table onto the gifts.
--
-- pushpay_donors was emptied on 2026-09-22: PushPay's "All Donors" export has
-- no stable donor id, so it can never be re-matched reliably, and the
-- Transactions export -- one row per gift, keyed by Payer ID -- is the giving
-- source from here on. Every stored builder query that still named the donor
-- table therefore returns nothing today. This file points all 22 of them at
-- pushpay_transactions and its per-payer rollup pushpay_payer_summary (0098),
-- and inserts the one block each affected page was missing: the window the
-- loaded gifts span, read live from pushpay_giving_snapshot.
--
-- WHAT THE NUMBERS NOW MEAN. PushPay's donor_stage is gone with the table, so
-- the stages are re-expressed from the gifts, in our words rather than
-- PushPay's (src/lib/giving-sql.ts holds the reasoning and is the single
-- source of the SQL below):
--   * recurring -- has a gift whose PushPay Source is 'Recurring';
--   * lapsed    -- no gift in the 90 days to the last gift in the data, so it
--                  cannot see anyone who stopped before the window opened;
--   * first seen -- a first gift inside those same 90 days, which means new to
--                  this import, not new to the church.
-- Two things every rewritten block obeys: no figure is money (the export
-- carries no amounts at all), and no figure reaches outside the gift window,
-- which is why each page now prints it.
--
-- WHERE THE TEXT COMES FROM. Every query, title and subtitle below is the
-- exact text of the matching block in src/lib/builder-seeds.ts (the giving
-- page) and src/lib/mir-metrics.ts (the two report pages), so a page re-seeded
-- from code and a page rewritten here say the same thing. Both templates
-- changed in the same commit; the MIR pages' seed fingerprints changed with
-- them, so the pristine ones are replaced from code on their next visit and
-- what this writes is what they will be replaced with.
--
-- Blocks are matched by page slug, kind and title, never by id, and only where
-- the block still names pushpay_donors -- so a second pass matches nothing,
-- inserts nothing (its anchor comes from the same predicate) and refuses
-- nothing. The file is safe to re-run, and a no-op on a database seeded from
-- the new code in the first place. Positions shift by one on the two pages that
-- gain the window block; builder_pages is left alone except for the giving
-- page's description, so no page starts to look edited (updated_at vs
-- created_at is how ensureSeededPage tells pristine from edited) and the MIR
-- fingerprints still decide re-seeding on their own.
--
-- UNDO HISTORY IS REWRITTEN TOO. builder_page_versions.snapshot embeds each
-- block's config as a JSON string inside JSON. Seven snapshots on the giving
-- page hold the donor-table queries; where the block id is still on the page
-- that config is replaced with the block's new one, and where the block has
-- since been deleted the query alone is replaced with a note (an orphan left
-- as it was would trip the leftovers check and wedge the deploy over an Undo
-- entry for a block nobody has). Every other block in those snapshots is left
-- exactly as it was. Undo therefore still restores the older layout, and can
-- no longer restore a query against an empty table.
--
-- The old code keeps serving between this file and the pm2 restart. It reads
-- stored SQL from the database, so it renders the rewritten blocks correctly;
-- what it gets wrong for those seconds is only its own hard-coded giving
-- reads, which this deploy replaces. Nothing is renamed or dropped, so nothing
-- fails with "no such table".
--
-- Measured on the 2026-09-22 production copy: 22 blocks and 7 snapshots
-- rewritten, 2 blocks inserted, none of the old text left behind, every
-- rewritten query runs and returns sensible counts (1,113 givers, 393 of them
-- on a schedule, 194 lapsed, 16,574 gifts over 2026-01-01 to 2026-09-16).
-- The file takes under 50 ms.
--
-- If a check fails, the guard (a throwaway TEMP table and triggers, as in
-- 0092 and 0097) rolls back the whole file with a message naming the check,
-- and nothing changes. IMMEDIATE because the guard reads before anything
-- writes. The file records itself in _migrations just before COMMIT, so the
-- change and its record commit together (0094's header explains why).
BEGIN IMMEDIATE;

CREATE TEMP TABLE _0099_guard (step TEXT NOT NULL);

-- The rollup this file points everything at has to exist and be built. 0098
-- creates and fills it; if it is missing or empty while gifts are stored, the
-- rewritten blocks would all read zero and the page would look broken rather
-- than empty.
CREATE TEMP TRIGGER _0099_refuse_rollup BEFORE INSERT ON _0099_guard
WHEN NEW.step = 'rollup' AND (
  NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pushpay_payer_summary')
  OR NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pushpay_giving_snapshot')
  OR EXISTS (SELECT 1 FROM pushpay_transactions t
              WHERE NOT EXISTS (SELECT 1 FROM pushpay_payer_summary s WHERE s.org_id = t.org_id)))
BEGIN
  SELECT RAISE(ROLLBACK, '0099 refused (rollup): pushpay_payer_summary / pushpay_giving_snapshot are missing, or an org has gifts with no rollup rows. Apply 0098 and let refreshPushpayGiving rebuild, then deploy again. Nothing was changed.');
END;

-- Every stored block this file knows how to rewrite must still be findable by
-- (slug, kind, title). If one has been retitled by hand, rewriting the rest
-- would leave that one reading an empty table with no sign of it.
CREATE TEMP TABLE _0099_targets (slug TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL);
INSERT INTO _0099_targets (slug, kind, title) VALUES
  ('giving', 'stat', 'Givers'),
  ('giving', 'stat', 'Recurring'),
  ('giving', 'stat', 'Lapsed'),
  ('giving', 'stat', 'First-time'),
  ('giving', 'stat', 'Donor records'),
  ('giving', 'stat', 'Unlinked'),
  ('giving', 'chart', 'Givers by membership'),
  ('giving', 'table', 'Giving coverage by membership'),
  ('giving', 'chart', 'Donor stage'),
  ('giving', 'chart', 'Last gift fund'),
  ('giving', 'chart', 'Giving channel'),
  ('giving', 'stat', 'Givers mapped'),
  ('giving', 'map', 'Givers'),
  ('giving', 'chart', 'Most recent gift by month'),
  ('mir-finance', 'stat', 'Donors on record'),
  ('mir-finance', 'stat', 'Gave in the last year'),
  ('mir-finance', 'stat', 'Recurring donors'),
  ('mir-finance', 'stat', 'Giving households reached'),
  ('mir-finance', 'chart', 'Donors by stage'),
  ('mir-finance', 'chart', 'How people give'),
  ('mir-finance', 'chart', 'How people give, all time'),
  ('mir-small-groups', 'chart', 'Other next steps among small group members');

-- Only while there is work to do: on a database where nothing names the donor
-- table (a fresh install seeded from the new code, or a second pass over one
-- this file has already rewritten) every target is legitimately absent.
CREATE TEMP TRIGGER _0099_refuse_missing BEFORE INSERT ON _0099_guard
WHEN NEW.step = 'targets'
 AND EXISTS (SELECT 1 FROM builder_blocks WHERE instr(config, 'pushpay_donors') > 0)
 AND EXISTS (
  SELECT 1 FROM _0099_targets t
   WHERE NOT EXISTS (
     SELECT 1 FROM builder_blocks b JOIN builder_pages p ON p.id = b.page_id
      WHERE p.slug = t.slug AND b.kind = t.kind
        AND json_extract(b.config, '$.title') = t.title
        AND instr(b.config, 'pushpay_donors') > 0))
BEGIN
  SELECT RAISE(ROLLBACK, '0099 refused (targets): a block this file rewrites is not where it was -- retitled, deleted, or already pointed somewhere else. Reconcile it by hand, then deploy again. Nothing was changed.');
END;

INSERT INTO _0099_guard (step) VALUES ('rollup'), ('targets');

DROP TRIGGER _0099_refuse_rollup;
DROP TRIGGER _0099_refuse_missing;

-- ── The window block each page was missing ─────────────────────────────────
-- Anchored where the page's giving blocks start, captured before anything
-- moves so the shift below cannot chase its own tail.
CREATE TEMP TABLE _0099_anchor AS
  SELECT p.id AS page_id, p.org_id AS org_id, p.slug AS slug, MIN(b.position) AS pos
    FROM builder_pages p
    JOIN builder_blocks b ON b.page_id = p.id
   WHERE p.slug IN ('giving', 'mir-finance')
     AND instr(b.config, 'pushpay_donors') > 0
   GROUP BY p.id;

UPDATE builder_blocks SET position = position + 1
 WHERE EXISTS (SELECT 1 FROM _0099_anchor a
                WHERE a.page_id = builder_blocks.page_id
                  AND builder_blocks.position >= a.pos);

INSERT INTO builder_blocks (page_id, org_id, position, kind, config)
SELECT a.page_id, a.org_id, a.pos, 'stat', '{"title":"Gift window","span":12,"sub":"every figure on this page counts gifts or people inside these dates — never an amount, which the export does not carry, and never anyone who stopped giving before the window opened","sql":"SELECT COALESCE((SELECT COALESCE(first_gift_on, ''(none)'') || '' to '' || COALESCE(last_gift_on, ''(none)'')\n              FROM pushpay_giving_snapshot WHERE org_id = :orgId), ''no gifts imported'')"}'
  FROM _0099_anchor a WHERE a.slug = 'giving';

INSERT INTO builder_blocks (page_id, org_id, position, kind, config)
SELECT a.page_id, a.org_id, a.pos, 'stat', '{"title":"Gift window","sub":"the dates the loaded PushPay export covers - no figure on this page reaches outside them, and none of them is an amount","sql":"SELECT COALESCE((SELECT COALESCE(first_gift_on, ''(none)'') || '' to '' || COALESCE(last_gift_on, ''(none)'')\n              FROM pushpay_giving_snapshot WHERE org_id = :orgId), ''no gifts imported'')","span":12}'
  FROM _0099_anchor a WHERE a.slug = 'mir-finance';

DROP TABLE _0099_anchor;

-- ── The rewrites ───────────────────────────────────────────────────────────
-- Only $.sql, $.title and $.sub are set, so a block someone has restyled --
-- the giving page's charts carry hand-picked types, colours and thresholds --
-- keeps its styling and changes only what it asks and how it says it.

-- giving
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(*) FROM (SELECT person_id AS pid,
                             MIN(first_gift_on)   AS firstGift,
                             MAX(last_gift_on)    AS lastGift,
                             SUM(gifts)           AS gifts,
                             SUM(recurring_gifts) AS recurringGifts
                        FROM pushpay_payer_summary
                       WHERE org_id=:orgId AND person_id IS NOT NULL
                       GROUP BY person_id)',
                         '$.title', 'Givers',
                         '$.sub', 'people linked to a gift')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Givers'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(*) FROM (SELECT person_id AS pid,
                             MIN(first_gift_on)   AS firstGift,
                             MAX(last_gift_on)    AS lastGift,
                             SUM(gifts)           AS gifts,
                             SUM(recurring_gifts) AS recurringGifts
                        FROM pushpay_payer_summary
                       WHERE org_id=:orgId AND person_id IS NOT NULL
                       GROUP BY person_id) WHERE recurringGifts > 0',
                         '$.title', 'On a schedule',
                         '$.sub', 'gave at least once through a recurring schedule')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Recurring'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(*) FROM (SELECT person_id AS pid,
                             MIN(first_gift_on)   AS firstGift,
                             MAX(last_gift_on)    AS lastGift,
                             SUM(gifts)           AS gifts,
                             SUM(recurring_gifts) AS recurringGifts
                        FROM pushpay_payer_summary
                       WHERE org_id=:orgId AND person_id IS NOT NULL
                       GROUP BY person_id) WHERE lastGift < (SELECT date(last_gift_on, ''-90 day'') FROM pushpay_giving_snapshot WHERE org_id = :orgId)',
                         '$.title', 'Lapsed',
                         '$.sub', 'no gift in the last 90 days of the window — our rule, read off the gifts, not a stage PushPay assigned')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Lapsed'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(*) FROM (SELECT person_id AS pid,
                             MIN(first_gift_on)   AS firstGift,
                             MAX(last_gift_on)    AS lastGift,
                             SUM(gifts)           AS gifts,
                             SUM(recurring_gifts) AS recurringGifts
                        FROM pushpay_payer_summary
                       WHERE org_id=:orgId AND person_id IS NOT NULL
                       GROUP BY person_id) WHERE firstGift >= (SELECT date(last_gift_on, ''-90 day'') FROM pushpay_giving_snapshot WHERE org_id = :orgId)',
                         '$.title', 'First seen',
                         '$.sub', 'first gift in those same 90 days — new to this import, not necessarily to the church')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'First-time'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COALESCE((SELECT gifts FROM pushpay_giving_snapshot WHERE org_id=:orgId), 0)',
                         '$.title', 'Gifts',
                         '$.sub', 'individual gifts — a count, never an amount')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Donor records'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(*) FROM pushpay_payer_summary WHERE org_id=:orgId AND person_id IS NULL',
                         '$.title', 'Unlinked payers',
                         '$.sub', 'PushPay payer ids with no person yet')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Unlinked'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COALESCE(p.membership_type,''(none)'') AS "Membership", COUNT(DISTINCT s.person_id) AS "Givers"
              FROM pushpay_payer_summary s JOIN pco_people p ON p.org_id=s.org_id AND p.pco_id=s.person_id
             WHERE s.org_id=:orgId AND s.person_id IS NOT NULL
             GROUP BY 1 ORDER BY 2 DESC',
                         '$.title', 'Givers by membership',
                         '$.sub', 'people with a gift in the window, by their PCO membership type')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'Givers by membership'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'WITH givers AS (SELECT DISTINCT person_id FROM pushpay_payer_summary WHERE org_id=:orgId AND person_id IS NOT NULL)
            SELECT COALESCE(p.membership_type,''(none)'') AS "Membership",
                   COUNT(*) AS "People",
                   COUNT(g.person_id) AS "Givers",
                   round(CAST(COUNT(g.person_id) AS REAL)/COUNT(*)*100) AS "Coverage %"
              FROM pco_people p
              LEFT JOIN givers g ON g.person_id=p.pco_id
             WHERE p.org_id=:orgId AND p.is_minor=0
               AND (p.membership_type IS NULL OR lower(p.membership_type) NOT LIKE ''%system use%'')
             GROUP BY 1 ORDER BY COUNT(g.person_id) DESC',
                         '$.title', 'Giving coverage by membership',
                         '$.sub', 'what share of each membership type has a gift in the window')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'table' AND json_extract(config, '$.title') = 'Giving coverage by membership'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT CASE WHEN s.last_gift_on < (SELECT date(last_gift_on, ''-90 day'') FROM pushpay_giving_snapshot WHERE org_id = :orgId) THEN ''Lapsed (no gift in 90 days)''
        WHEN s.recurring_gifts > 0 THEN ''Recurring schedule''
        ELSE ''Not on a schedule'' END AS "Pattern", COUNT(*) AS "Payers"
              FROM pushpay_payer_summary s WHERE s.org_id=:orgId GROUP BY 1 ORDER BY 2 DESC',
                         '$.title', 'Giving pattern',
                         '$.sub', 'worked out from the gifts themselves — PushPay''s own donor stages came with the All Donors export, which is no longer loaded')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'Donor stage'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COALESCE(fund_name,''(none)'') AS "Fund", COUNT(*) AS "Gifts"
              FROM pushpay_transactions WHERE org_id=:orgId GROUP BY 1 ORDER BY 2 DESC LIMIT 12',
                         '$.title', 'Gifts by fund',
                         '$.sub', 'how many gifts each fund received — counts, not amounts')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'Last gift fund'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COALESCE(source,''(unknown)'') AS "Channel", COUNT(*) AS "Gifts"
              FROM pushpay_transactions WHERE org_id=:orgId GROUP BY 1 ORDER BY 2 DESC',
                         '$.title', 'How gifts arrive',
                         '$.sub', 'PushPay''s channel on each gift — Batch Entry is cash or a cheque keyed in afterwards, so its date lags the Sunday')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'Giving channel'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(DISTINCT s.person_id)
              FROM pushpay_payer_summary s JOIN person_geo g ON g.org_id=s.org_id AND g.person_id=s.person_id
             WHERE s.org_id=:orgId AND s.person_id IS NOT NULL AND g.status=''ok'' AND g.lat IS NOT NULL',
                         '$.title', 'Givers mapped',
                         '$.sub', 'geocoded to a home')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Givers mapped'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT g.lat, g.lng, MAX(CASE WHEN s.last_gift_on < (SELECT date(last_gift_on, ''-90 day'') FROM pushpay_giving_snapshot WHERE org_id = :orgId) THEN ''Lapsed (no gift in 90 days)''
        WHEN s.recurring_gifts > 0 THEN ''Recurring schedule''
        ELSE ''Not on a schedule'' END) AS "Pattern"
              FROM pushpay_payer_summary s JOIN person_geo g ON g.org_id=s.org_id AND g.person_id=s.person_id
             WHERE s.org_id=:orgId AND s.person_id IS NOT NULL AND g.status=''ok'' AND g.lat IS NOT NULL
             GROUP BY s.person_id, g.lat, g.lng LIMIT 4000',
                         '$.title', 'Givers',
                         '$.sub', 'one pin per giver with a geocoded home')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'map' AND json_extract(config, '$.title') = 'Givers'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT substr(received_on,1,7) AS "Month",
                   COUNT(*) AS "Gifts",
                   COUNT(DISTINCT COALESCE(payer_id,''tx:''||transaction_id)) AS "Payers giving"
              FROM pushpay_transactions WHERE org_id=:orgId AND received_on IS NOT NULL
             GROUP BY 1 ORDER BY 1',
                         '$.title', 'Gifts and givers by month',
                         '$.sub', 'every gift by the date PushPay recorded it, and how many payers are behind them — cash and cheques are keyed in afterwards, so their month can lag the Sunday')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'Most recent gift by month'
   AND instr(config, 'pushpay_donors') > 0;

-- mir-finance
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COALESCE((SELECT payers FROM pushpay_giving_snapshot WHERE org_id = :orgId), 0)',
                         '$.title', 'Payers on record',
                         '$.sub', 'PushPay payer ids with a gift in the window, whether or not we can name the person behind them')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Donors on record'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(*) FROM pushpay_payer_summary
          WHERE org_id = :orgId AND last_gift_on >= (SELECT date(last_gift_on, ''-90 day'') FROM pushpay_giving_snapshot WHERE org_id = :orgId)',
                         '$.title', 'Gave in the last 90 days',
                         '$.sub', 'payers with a gift in the last 90 days of the window')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Gave in the last year'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(*) FROM pushpay_payer_summary
          WHERE org_id = :orgId AND recurring_gifts > 0',
                         '$.title', 'Payers giving on a schedule',
                         '$.sub', 'payers with at least one Recurring gift - a schedule set up in advance, which cannot respond to a given Sunday. Payers, not people: the /giving page counts the same schedules per person and reads lower')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Recurring donors'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT COUNT(DISTINCT hm.household_id)
           FROM pushpay_payer_summary s
           JOIN pco_household_memberships hm
             ON hm.person_id = s.person_id AND hm.org_id = :orgId
          WHERE s.org_id = :orgId AND s.person_id IS NOT NULL',
                         '$.title', 'Giving households reached',
                         '$.sub', 'distinct households with a giver in the window')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'stat' AND json_extract(config, '$.title') = 'Giving households reached'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT CASE WHEN s.last_gift_on < (SELECT date(last_gift_on, ''-90 day'') FROM pushpay_giving_snapshot WHERE org_id = :orgId) THEN ''Lapsed (no gift in 90 days)''
        WHEN s.recurring_gifts > 0 THEN ''Recurring schedule''
        ELSE ''Not on a schedule'' END AS "Pattern", COUNT(*) AS "Payers"
           FROM pushpay_payer_summary s WHERE s.org_id = :orgId
          GROUP BY 1 ORDER BY 2 DESC',
                         '$.title', 'Giving pattern',
                         '$.sub', 'worked out from the gifts themselves - PushPay''s own donor stages came with the All Donors export, which is no longer loaded')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'Donors by stage'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT CASE WHEN pm.offline_gifts > 0 AND pm.online_gifts > 0 THEN ''Both''
        WHEN pm.offline_gifts > 0 THEN ''Check or cash''
        ELSE ''Online'' END AS "How they gave",
                COUNT(*) AS "Payers"
           FROM (SELECT COALESCE(payer_id, ''tx:'' || transaction_id) AS pk,
          MAX(CASE WHEN source = ''Batch Entry'' THEN 1 ELSE 0 END) AS offline_gifts,
          MAX(CASE WHEN source IS NULL OR source <> ''Batch Entry'' THEN 1 ELSE 0 END) AS online_gifts
     FROM pushpay_transactions
    WHERE org_id = :orgId AND received_on >= (SELECT date(last_gift_on, ''-90 day'') FROM pushpay_giving_snapshot WHERE org_id = :orgId)
    GROUP BY 1) pm
          GROUP BY 1 ORDER BY 2 DESC',
                         '$.title', 'How payers give',
                         '$.sub', 'payers with a gift in the last 90 days of the window, by method - payer ids, so a household with two of them counts twice')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'How people give'
   AND instr(config, 'pushpay_donors') > 0;
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', 'SELECT CASE WHEN pm.offline_gifts > 0 AND pm.online_gifts > 0 THEN ''Both''
        WHEN pm.offline_gifts > 0 THEN ''Check or cash''
        ELSE ''Online'' END AS "How they gave",
                COUNT(*) AS "Payers"
           FROM (SELECT COALESCE(payer_id, ''tx:'' || transaction_id) AS pk,
          MAX(CASE WHEN source = ''Batch Entry'' THEN 1 ELSE 0 END) AS offline_gifts,
          MAX(CASE WHEN source IS NULL OR source <> ''Batch Entry'' THEN 1 ELSE 0 END) AS online_gifts
     FROM pushpay_transactions
    WHERE org_id = :orgId
    GROUP BY 1) pm
          GROUP BY 1 ORDER BY 2 DESC',
                         '$.title', 'How payers give, whole window',
                         '$.sub', 'every payer with a gift anywhere in the window, by method - these total the Payers on record above, not the people behind them')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'How people give, all time'
   AND instr(config, 'pushpay_donors') > 0;

-- mir-small-groups
UPDATE builder_blocks
   SET config = json_set(config, '$.sql', '
        WITH sg AS (
          SELECT DISTINCT gm.person_id AS person_id
            FROM pco_group_memberships gm
            JOIN pco_groups       g  ON g.org_id  = gm.org_id AND g.pco_id  = gm.group_id
            JOIN pco_group_types  gt ON gt.org_id = g.org_id  AND gt.pco_id = g.group_type_id
           WHERE gm.org_id = :orgId
             AND gt.name = ''Small Groups''
             AND g.archived_at  IS NULL
             AND gm.archived_at IS NULL
        ),
        flags AS (
          SELECT sg.person_id,
                 CASE WHEN EXISTS (SELECT 1 FROM pco_team_memberships tm
                                    WHERE tm.org_id = :orgId
                                      AND tm.person_id = sg.person_id
                                      AND tm.archived_at IS NULL) THEN 1 ELSE 0 END AS serving,
                 CASE WHEN EXISTS (SELECT 1 FROM pushpay_payer_summary s
                                    WHERE s.org_id = :orgId
                                      AND s.person_id = sg.person_id) THEN 1 ELSE 0 END AS giving
            FROM sg
        )
        -- The two giving rows carry the gift window in their label. Giving
        -- here means a gift inside the loaded PushPay Transactions export, not
        -- ever, and a bar that just said "Also giving" would be read as ever.
        SELECT "Next step", "People" FROM (
          SELECT ''In a small group''       AS "Next step", COUNT(*) AS "People", 1 AS ord FROM flags
          UNION ALL
          SELECT ''Also serving on a team'', COALESCE(SUM(serving), 0), 2 FROM flags
          UNION ALL
          SELECT ''Also giving, '' || COALESCE((SELECT COALESCE(first_gift_on, ''(none)'') || '' to '' || COALESCE(last_gift_on, ''(none)'')
              FROM pushpay_giving_snapshot WHERE org_id = :orgId), ''no gifts imported''), COALESCE(SUM(giving), 0),  3 FROM flags
          UNION ALL
          SELECT ''Serving and giving, '' || COALESCE((SELECT COALESCE(first_gift_on, ''(none)'') || '' to '' || COALESCE(last_gift_on, ''(none)'')
              FROM pushpay_giving_snapshot WHERE org_id = :orgId), ''no gifts imported''),
                 COALESCE(SUM(CASE WHEN serving = 1 AND giving = 1 THEN 1 ELSE 0 END), 0), 4 FROM flags
        ) ORDER BY ord',
                         '$.title', 'Other next steps among small group members',
                         '$.sub', 'people in a small group who are also serving, or who gave inside the PushPay gift window')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-small-groups')
   AND kind = 'chart' AND json_extract(config, '$.title') = 'Other next steps among small group members'
   AND instr(config, 'pushpay_donors') > 0;

-- The reconnect list runs through a named source rather than SQL, so it never
-- named the donor table; its subtitle described PushPay's donor stage, which
-- no longer exists, and the source behind it is now its own query.
UPDATE builder_blocks
   SET config = json_set(config, '$.sub', 'givers with no gift in the last 90 days of the window, longest silence first — it cannot see anyone who stopped before the window opened')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'table' AND json_extract(config, '$.title') = 'Lapsed givers to reconnect'
   AND instr(lower(config), 'donor stage') > 0;

UPDATE builder_blocks
   SET config = json_set(config, '$.sub', 'one row per giver, most recent gift first — gift counts, not amounts')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'table' AND json_extract(config, '$.title') = 'Giving directory'
   AND json_extract(config, '$.source') = 'giving_directory';

-- The last piece of All Donors vocabulary on the page: the section heading
-- above the reconnect list. A divider carries no SQL, so it was out of reach
-- of every rewrite above -- but it is the first word a reader meets over a
-- section that is now entirely about givers, and the seed already calls it
-- Givers. Matched on its own title so a second pass finds nothing.
UPDATE builder_blocks
   SET config = json_set(config, '$.title', 'Givers')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'giving')
   AND kind = 'divider' AND json_extract(config, '$.title') = 'Donors';

-- The Finance report's closing note described an all-time donor layer beneath
-- the gifts. There is no such layer any more, so it is replaced with the note
-- the template now carries.
UPDATE builder_blocks
   SET config = json_set(config, '$.text', '### What these numbers do and don''t cover

Measured here: every individual gift in the loaded window — who gave, how often, through which channel, to which fund — and the people and households behind them. All of it counts gifts and people; none of it is money.

**NO AMOUNTS, BY DESIGN AND BY DATA.** The Transactions export carries no dollar figure at all, which matches the instruction that these reports show giving without money. Nothing on this page is a financial total, and no total could be derived from it.
**THE WINDOW IS THE WHOLE STORY.** Everything here is bounded by the gift window printed at the top — 1 Jan to 16 Sep 2026 today. There is no longer an all-time layer beneath it: the All Donors export, which carried PushPay''s own donor stages over its full history, was emptied on 22 September 2026 because it has no stable donor id to re-match on. So nobody who stopped giving before January 2026 appears anywhere on this page, "gone quiet" means quiet inside the window, and no year-over-year comparison is possible until an export covering earlier years is loaded.
**"Recurring", "lapsed" and "first seen" are our words, not PushPay''s.** They are derived from the gifts: a Recurring source on a gift, 90 days of silence before the window''s last gift, and a first gift inside those same 90 days. PushPay''s own stage names are deliberately not reused, because the thresholds behind them were not ours.
**82% of gifts are linked to a person.** 13,626 of 16,574 resolve to a PCO record through the “Your ID” field, which carries the PCO person id. The remaining 2,948 belong to payers with no id on their PushPay record; filling that field in PushPay and uploading the export again is what places them.
**“Check or cash” means keyed in afterwards.** It is PushPay’s Batch Entry channel, which is how plate giving is recorded, so its date lags the Sunday it was given on. A Kiosk gift happens on campus but is an electronic transaction and counts as online.
**Two counts of a gift, 0.7% apart.** The gift-level blocks count only Status = Success (16,451); the payer rollup behind the people-level blocks counts every row, including the 123 still processing (16,574).
**A payer is not a person.** Blocks titled “payers” count PushPay payer ids — 1,669 of them — and blocks titled “people” count the 1,113 PCO records those ids resolve to. The gap is the 548 payers with no “Your ID” plus the households that hold two ids, so the two never agree and neither is wrong; check the title before quoting either.
**Budget performance, expense ratios and designated-fund balances** live in the accounting system, which is not synced.

_Of the 1,113 people this window can put a name to, 185 gave exactly once and 177 gave 27 times or more — a spread the donor-summary import could not see at all. Counting every payer including the unlinked, it is 422 giving once against 194 giving 27+. Measured on the 22 September 2026 export; these five are written out rather than queried, so re-read them off the page''s own blocks after the next import._')
 WHERE page_id IN (SELECT id FROM builder_pages WHERE slug = 'mir-finance')
   AND kind = 'text' AND instr(config, 'Budget performance') > 0;

-- The giving page's own description named the donor export.
UPDATE builder_pages
   SET description = 'Giving from the imported PushPay Transactions export — who gives, membership vs. giving coverage, how people give, funds, channels, where givers live, recency, and first gifts. Gift and giver counts only: the export carries no amounts. Import or refresh on the PushPay page.'
 WHERE slug = 'giving' AND description LIKE '%donor export%';

-- ── Undo history ───────────────────────────────────────────────────────────
-- Each snapshot's blocks array is rebuilt element by element: a block whose
-- stored config named the donor table takes that block's new config, every
-- other block keeps the config the snapshot recorded. json_set on a TEXT
-- argument stores it as a JSON string, which is how a snapshot holds a config,
-- and json() re-marks each rebuilt element as JSON so json_group_array nests
-- it rather than quoting it. json_each walks the array in order.
--
-- A SNAPSHOT CAN NAME A BLOCK THAT NO LONGER EXISTS. Undo keeps ten snapshots
-- per page and the giving page is hand-edited, so a block deleted between this
-- file being written and the deploy landing leaves its config behind in the
-- history with nothing live to copy from. Taking the recorded config in that
-- case would leave the donor table named, the leftovers check below would
-- roll the whole file back, _migrations would not get its row, and the deploy
-- would stop before the pm2 restart with the new build already on disk (see
-- SCHEMA.md §5) -- over an Undo entry for a block nobody has. So the orphan is
-- neutralised instead: its query is replaced with a note saying what happened.
-- Undo can still restore that block's title, kind and layout; what it can no
-- longer do is restore a query against an empty table, which is the one thing
-- this file exists to remove.
UPDATE builder_page_versions AS v
   SET snapshot = json_set(v.snapshot, '$.blocks', (
         SELECT json_group_array(json(json_set(e.value, '$.config',
                  CASE
                    -- Not a donor query: recorded exactly as it was.
                    WHEN instr(json_extract(e.value, '$.config'), 'pushpay_donors') = 0
                      THEN json_extract(e.value, '$.config')
                    -- The block is still on the page, so it has been rewritten
                    -- above and the snapshot takes its new config.
                    WHEN EXISTS (SELECT 1 FROM builder_blocks b
                                  WHERE b.id = json_extract(e.value, '$.id'))
                      THEN (SELECT b.config FROM builder_blocks b
                             WHERE b.id = json_extract(e.value, '$.id'))
                    -- Orphan: the block was deleted. Keep everything but the
                    -- query, and say so where a subtitle would show.
                    -- The trailing || '' is load-bearing. json_set returns a
                    -- value SQLite has marked as JSON, and the outer json_set
                    -- would then nest it as an OBJECT where a snapshot holds
                    -- its config as a STRING. Concatenating an empty string
                    -- drops that marking and gives plain text (CAST does not);
                    -- without it the snapshot check below rejects the file.
                    WHEN json_valid(json_extract(e.value, '$.config'))
                      THEN (json_set(json_extract(e.value, '$.config'),
                             '$.sql', 'SELECT ''this block was deleted before giving moved onto the gifts'' AS "Note"',
                             '$.sub', 'the query this Undo entry recorded read the All Donors export, which is empty, and the block itself is gone -- 0099 replaced the query rather than restore one that can only return nothing') || '')
                    -- Config that is not even JSON: replaced outright, since
                    -- nothing can be read out of it to keep.
                    ELSE '{"title":"Removed block","sql":"SELECT ''this block was deleted before giving moved onto the gifts'' AS \"Note\""}'
                  END)))
           FROM json_each(v.snapshot, '$.blocks') e))
 WHERE instr(v.snapshot, 'pushpay_donors') > 0;

-- ── Checks ─────────────────────────────────────────────────────────────────
CREATE TEMP TRIGGER _0099_refuse_leftovers BEFORE INSERT ON _0099_guard
WHEN NEW.step = 'leftovers' AND (
  EXISTS (SELECT 1 FROM builder_blocks WHERE instr(config, 'pushpay_donors') > 0)
  OR EXISTS (SELECT 1 FROM builder_page_versions WHERE instr(snapshot, 'pushpay_donors') > 0))
BEGIN
  SELECT RAISE(ROLLBACK, '0099 refused (leftovers): a builder block or Undo snapshot still names pushpay_donors after the rewrite. Nothing was changed.');
END;

-- A snapshot must come back with the same blocks in the same order, only its
-- donor-table configs replaced: json_group_array building the array badly
-- would show up here as a different id sequence or a lost block.
CREATE TEMP TRIGGER _0099_refuse_snapshot BEFORE INSERT ON _0099_guard
WHEN NEW.step = 'snapshot' AND EXISTS (
  SELECT 1 FROM builder_page_versions v
   WHERE json_type(v.snapshot, '$.blocks') <> 'array'
      OR EXISTS (SELECT 1 FROM json_each(v.snapshot, '$.blocks') e
                  WHERE json_extract(e.value, '$.id') IS NULL
                     OR json_extract(e.value, '$.position') IS NULL
                     OR json_type(e.value, '$.config') <> 'text'))
BEGIN
  SELECT RAISE(ROLLBACK, '0099 refused (snapshot): an Undo snapshot came back malformed after the rewrite. Nothing was changed.');
END;

-- Every page keeps distinct positions: the shift above must not have collided
-- with the inserted window block.
CREATE TEMP TRIGGER _0099_refuse_positions BEFORE INSERT ON _0099_guard
WHEN NEW.step = 'positions' AND EXISTS (
  SELECT 1 FROM builder_blocks GROUP BY page_id, position HAVING COUNT(*) > 1)
BEGIN
  SELECT RAISE(ROLLBACK, '0099 refused (positions): two blocks on one page share a position after the insert. Nothing was changed.');
END;

INSERT INTO _0099_guard (step) VALUES ('leftovers'), ('snapshot'), ('positions');

DROP TRIGGER _0099_refuse_leftovers;
DROP TRIGGER _0099_refuse_snapshot;
DROP TRIGGER _0099_refuse_positions;
DROP TABLE _0099_targets;
DROP TABLE _0099_guard;

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0099_giving_on_transactions.sql');
COMMIT;
