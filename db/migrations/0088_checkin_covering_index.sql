-- Check-in pages read pco_check_ins without touching the table itself.
--
-- The /checkins summary and its per-event list both aggregate over event_id,
-- person_id and pco_created_at for one org. With an index on (org_id, event_id)
-- alone, every one of the ~275k rows cost a second lookup into the table to
-- fetch the other two columns. On production the database is larger than the
-- memory available to cache it, so those lookups were real disk reads.
--
-- Widening the existing event index to carry person_id and pco_created_at makes
-- it covering for both queries. Measured on a production copy, warm cache:
--   summary    191 ms -> 119 ms
--   per-event  122 ms ->  52 ms
-- with identical results. The obvious alternative, adding person_id to
-- pco_check_ins_created, was measured too and made the per-event list slower
-- (223 ms), because that query groups by event_id.
DROP INDEX IF EXISTS pco_check_ins_event;
CREATE INDEX pco_check_ins_event
  ON pco_check_ins(org_id, event_id, person_id, pco_created_at);

-- Refresh the query planner's statistics. They had drifted up to 20x from the
-- real row counts (pco_event_attendances was costed as 5,279 rows; it holds
-- 108,922), which makes the planner choose scans where it should seek.
--
-- A FULL analyze, deliberately not a sampled one. analysis_limit reads only the
-- first N entries of each index, and every index here leads with org_id — one
-- value — then the person, so a 400-entry sample sees a handful of people and
-- concludes each has 401 check-ins (really 32). The planner then scanned the
-- whole org through this covering index to find one person's check-ins: the
-- person page went 74 ms -> 97 ms, two lookups 0.01 ms -> 13 ms and 9 ms.
-- Full stats put both back on a direct seek and keep /checkins covering.
-- 3.7 s on a production copy, once, during the deploy.
PRAGMA analysis_limit = 0;
ANALYZE;
