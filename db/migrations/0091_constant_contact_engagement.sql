-- Constant Contact engagement rollups, so /constant-contact/dashboard stops
-- re-counting cc_contact_activity on every render.
--
-- The dashboard asked ~30 questions of cc_contact_activity (234k rows, ~77 MB
-- with its indexes) with ~12 full traversals per render: 8.6 s of SQL measured
-- on the production box. The answers only change when the Constant Contact
-- sync writes new tracking rows, so they are built once per sync instead, like
-- person_activity / org_snapshot are for PCO. On a production copy (M2, warm,
-- the app's pragmas) the dashboard's 19 read calls went from 882 ms to 132 ms
-- with identical output; what is left is mostly cc_contacts / person_activity.
--
--   cc_contact_engagement   one row per contact with any tracked activity
--   cc_link_clicks          one row per clicked URL
--   cc_engagement_snapshot  one row per org: org-wide totals, and the
--                           watermark saying which activity rows were counted
--
-- Built by refreshCcEngagement() (src/lib/constant-contact-sync.ts) at the end
-- of EVERY runCcSync attempt, success or failure, and by the cron tick whenever
-- isCcEngagementStale() says the watermark no longer matches. The build SQL
-- below is the same as that function's; keep them in step.
--
-- Nothing here copies cc_contacts.person_id: relinking re-points contacts at
-- people on every sync, so readers join cc_contacts live (6k PK lookups, a few
-- ms) rather than trusting a second copy that could drift.

-- Counts are rows of cc_contact_activity, whose key is
-- (campaign, contact, type, link): opens = campaigns opened, clicks = distinct
-- (campaign, link) pairs clicked.
CREATE TABLE IF NOT EXISTS cc_contact_engagement (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  opens INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  bounces INTEGER NOT NULL DEFAULT 0,
  optouts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, contact_id)
);

-- Clicks per destination URL (empty URLs excluded, as the dashboard always
-- did). A covering index on the raw table was measured as the alternative:
-- 1.7 ms per render against 0.3 ms here, for 4.4 MB more index on every sync.
CREATE TABLE IF NOT EXISTS cc_link_clicks (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  link_url TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  PRIMARY KEY (org_id, link_url)
);

-- activity_rows: COUNT(*) of the org's cc_contact_activity rows that were
-- counted (the dashboard shows it).
--
-- activity_watermark_rowid: MAX(rowid) of the WHOLE cc_contact_activity table,
-- every org, read inside the build's transaction. It is the staleness
-- watermark. That table has no synced_at, and the sync only ever appends to it
-- (INSERT OR IGNORE; nothing in the app updates or deletes a row), so any new
-- row, for any org, raises it. Checking it is one seek on the rowid b-tree:
-- 0.003-0.007 ms and +0.2 MB RSS. A per-org COUNT/MAX walked the 13 MB
-- (org_id, campaign) index every cron tick: 7-8 ms warm, 12-229 ms on first
-- touch, and +14-15 MB RSS in a process capped at 150 MB. The cost of going
-- table-wide is an unneeded ~170 ms rebuild of an org when a different org
-- syncs. Only one org has CC data. Anything that ever deletes or rewrites
-- activity rows must call refreshCcEngagement() itself.
--
-- opens_sun..opens_sat: opens by weekday of activity_time (UTC, strftime %w).
-- Kept here, not recomputed per render, because it needs activity_time from
-- every open row: 81 ms per render as it was, still 65 ms with a covering
-- (org_id, activity_type, activity_time) index built to test it.
CREATE TABLE IF NOT EXISTS cc_engagement_snapshot (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  activity_rows INTEGER NOT NULL,
  activity_watermark_rowid INTEGER NOT NULL,
  opens_sun INTEGER NOT NULL DEFAULT 0,
  opens_mon INTEGER NOT NULL DEFAULT 0,
  opens_tue INTEGER NOT NULL DEFAULT 0,
  opens_wed INTEGER NOT NULL DEFAULT 0,
  opens_thu INTEGER NOT NULL DEFAULT 0,
  opens_fri INTEGER NOT NULL DEFAULT 0,
  opens_sat INTEGER NOT NULL DEFAULT 0,
  built_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Populate now, so the new code's first render is correct before the next CC
-- sync. The old code never reads these tables, so running this while it still
-- serves is harmless; if the old code syncs in the meantime, the watermark goes
-- stale and the new code's first cron tick rebuilds. One transaction, deleting
-- first, so a re-run after a half-failed deploy starts clean.
BEGIN;
DELETE FROM cc_contact_engagement;
DELETE FROM cc_link_clicks;
DELETE FROM cc_engagement_snapshot;

INSERT INTO cc_contact_engagement (org_id, contact_id, opens, clicks, bounces, optouts)
SELECT org_id, contact_id,
       SUM(activity_type = 'open'), SUM(activity_type = 'click'),
       SUM(activity_type = 'bounce'), SUM(activity_type = 'optout')
  FROM cc_contact_activity
 GROUP BY org_id, contact_id;

INSERT INTO cc_link_clicks (org_id, link_url, clicks)
SELECT org_id, link_url, COUNT(*)
  FROM cc_contact_activity
 WHERE activity_type = 'click' AND link_url <> ''
 GROUP BY org_id, link_url;

INSERT INTO cc_engagement_snapshot
  (org_id, activity_rows, activity_watermark_rowid,
   opens_sun, opens_mon, opens_tue, opens_wed, opens_thu, opens_fri, opens_sat)
SELECT t.org_id, t.n, (SELECT COALESCE(MAX(rowid), 0) FROM cc_contact_activity),
       COALESCE(d.sun, 0), COALESCE(d.mon, 0), COALESCE(d.tue, 0), COALESCE(d.wed, 0),
       COALESCE(d.thu, 0), COALESCE(d.fri, 0), COALESCE(d.sat, 0)
  FROM (SELECT org_id, COUNT(*) AS n FROM cc_contact_activity GROUP BY org_id) t
  LEFT JOIN (
        SELECT org_id,
               SUM(CASE WHEN dow = 0 THEN n END) AS sun, SUM(CASE WHEN dow = 1 THEN n END) AS mon,
               SUM(CASE WHEN dow = 2 THEN n END) AS tue, SUM(CASE WHEN dow = 3 THEN n END) AS wed,
               SUM(CASE WHEN dow = 4 THEN n END) AS thu, SUM(CASE WHEN dow = 5 THEN n END) AS fri,
               SUM(CASE WHEN dow = 6 THEN n END) AS sat
          FROM (SELECT org_id, CAST(strftime('%w', activity_time) AS INTEGER) AS dow, COUNT(*) AS n
                  FROM cc_contact_activity
                 WHERE activity_type = 'open' AND activity_time IS NOT NULL
                 GROUP BY org_id, dow)
         GROUP BY org_id) d ON d.org_id = t.org_id;
COMMIT;

-- Statistics for the new tables. With none, SQLite guesses ~10 rows per org_id
-- and joins in the wrong order: one dashboard query went from 27 ms to 2.4 s
-- that way before it was rewritten to pin its join order. Future readers of
-- these tables deserve the real numbers too. A few ms: the tables are small.
ANALYZE cc_contact_engagement;
ANALYZE cc_link_clicks;
ANALYZE cc_engagement_snapshot;
