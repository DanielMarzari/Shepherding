-- Plan-date upper bounds that dropped every plan dated today, in stored builder SQL.
--
-- pco_plans.sort_date is a full timestamp holding the local service time with a
-- nominal Z ('2026-09-13T08:00:00Z' is the 8 am service). Compared as text,
-- `sort_date <= date('now')` is false for every plan dated today because the
-- date is a prefix and sorts first, and `sort_date <= datetime('now')` is false
-- too because 'T' sorts above datetime()'s space. On Sunday 2026-09-13 the old
-- predicates excluded all 10 plans that day and the 152 people on them.
--
-- The templates in src/lib/mir-metrics.ts now say `sort_date < ${TOMORROW}`:
-- tomorrow by the Eastern calendar, easternDate applied to 'now' and collapsed
-- onto one line (why that form, and not date('now','+1 day') or substr(): see
-- the comment on TOMORROW there). This brings the copies already stored in
-- builder pages, and in their Undo history, to the same text. The bound below
-- is TOMORROW's expansion, character for character.
--
-- The substrings are replaced exactly as stored. Neither the old nor the new
-- text holds a double quote, backslash or newline, the only characters JSON
-- escapes here, so they read the same in builder_blocks.config and in
-- builder_page_versions.snapshot, where each block's config is a JSON string
-- inside JSON. On the 2026-09-21 production copy this rewrites 17 blocks on 7
-- pages and 5 Undo snapshots and leaves none of the old forms behind. Every
-- rewritten config still parses and every rewritten query still runs.
--
-- Seeded pages stay consistent. Only config and snapshot text change:
-- builder_pages (updated_at vs created_at is how ensureSeededPage tells a
-- pristine page from an edited one) and seed_revision are not touched, so no
-- page starts to look edited. After the restart the new templates carry new
-- fingerprints, and each pristine page is replaced once from its template,
-- blocks deleted and reinserted in one transaction. Where the page was already
-- current the new blocks are byte-identical to what this wrote. The edited
-- page (Original Music) is never replaced, so this migration is the only thing
-- that fixes it. The old code, still serving while this runs, sees the same
-- stored revisions as before. A page it re-seeds in that window gets the old
-- text back, and the new code replaces it again on the next visit.
--
-- Safe to re-run: the replacements do not contain what they replace, so a second
-- pass matches no rows.
BEGIN;

WITH bound(tomorrow) AS (SELECT
  'date(CASE WHEN date(''now'') >= date(strftime(''%Y'', ''now'') || ''-03-08'', ''weekday 0'') AND date(''now'') < date(strftime(''%Y'', ''now'') || ''-11-01'', ''weekday 0'') THEN date(''now'', ''-4 hours'') ELSE date(''now'', ''-5 hours'') END, ''+1 day'')')
UPDATE builder_blocks
   SET config =
       replace(replace(replace(config,
         'pl.sort_date <= date(''now'')',      'pl.sort_date < '  || (SELECT tomorrow FROM bound)),
         'pl.sort_date <= datetime(''now'')',  'pl.sort_date < '  || (SELECT tomorrow FROM bound)),
         'AND sort_date <= datetime(''now'')', 'AND sort_date < ' || (SELECT tomorrow FROM bound))
 WHERE instr(config, 'sort_date <= date(''now'')') > 0
    OR instr(config, 'sort_date <= datetime(''now'')') > 0;

WITH bound(tomorrow) AS (SELECT
  'date(CASE WHEN date(''now'') >= date(strftime(''%Y'', ''now'') || ''-03-08'', ''weekday 0'') AND date(''now'') < date(strftime(''%Y'', ''now'') || ''-11-01'', ''weekday 0'') THEN date(''now'', ''-4 hours'') ELSE date(''now'', ''-5 hours'') END, ''+1 day'')')
UPDATE builder_page_versions
   SET snapshot =
       replace(replace(replace(snapshot,
         'pl.sort_date <= date(''now'')',      'pl.sort_date < '  || (SELECT tomorrow FROM bound)),
         'pl.sort_date <= datetime(''now'')',  'pl.sort_date < '  || (SELECT tomorrow FROM bound)),
         'AND sort_date <= datetime(''now'')', 'AND sort_date < ' || (SELECT tomorrow FROM bound))
 WHERE instr(snapshot, 'sort_date <= date(''now'')') > 0
    OR instr(snapshot, 'sort_date <= datetime(''now'')') > 0;

COMMIT;
