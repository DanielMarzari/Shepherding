-- Put the vocabulary back, and say why it needed putting back.
--
-- 0107 renamed the stored classifications (active -> known, present and
-- inactive -> unknown) and the readers with them. It did not change the
-- UPDATE in dashboard-refresh.ts that WRITES them. So the data was correct
-- until the first nightly snapshot refresh after that deploy, which wrote
-- the retired words back over all 34,880 rows:
--
--   sync run 197  2026-10-26 15:41Z
--   sync run 199  2026-10-27 02:33Z
--
-- After that, every page filtering on 'known' counted nothing. Known read 0
-- on /people and on the home dashboard, while 9,213 people sat in 'active'
-- and 'present' — bands no reader has looked for since 0107.
--
-- The writer is fixed in the same commit as this migration. This repairs the
-- rows now rather than leaving the app wrong until the next sync, which is
-- twenty minutes of work on a schedule nobody wants to wait for to see their
-- own congregation.
--
-- Same mapping as 0107, and idempotent: on a database whose last refresh ran
-- the fixed code these four statements match nothing.

BEGIN IMMEDIATE;

UPDATE person_activity SET classification = 'known'
 WHERE classification = 'active';
UPDATE person_activity SET classification = 'unknown'
 WHERE classification IN ('present', 'inactive');

-- org_snapshot is a rollup of the above, and its rebuild counts the three
-- current bands — so known_count went to 0 with the rest. Recompute the
-- three counts and their kid subsets from person_activity directly.
--
-- One difference from the application's own rebuild, stated rather than
-- hidden: that one drops excluded membership types (pco_sync_settings), and
-- this does not, because reading that setting means parsing JSON in SQL. The
-- numbers here are therefore slightly high until the next refresh, which
-- recomputes them properly. Being a little high for a few hours beats
-- reading zero.
UPDATE org_snapshot
   SET shepherded_count = (
         SELECT COUNT(*) FROM person_activity
          WHERE org_id = org_snapshot.org_id AND classification = 'shepherded'),
       known_count = (
         SELECT COUNT(*) FROM person_activity
          WHERE org_id = org_snapshot.org_id AND classification = 'known'),
       unknown_count = (
         SELECT COUNT(*) FROM person_activity
          WHERE org_id = org_snapshot.org_id AND classification = 'unknown'),
       shepherded_kids = (
         SELECT COUNT(*) FROM person_activity pa JOIN pco_people p
                ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
          WHERE pa.org_id = org_snapshot.org_id
            AND pa.classification = 'shepherded' AND p.is_minor = 1),
       known_kids = (
         SELECT COUNT(*) FROM person_activity pa JOIN pco_people p
                ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
          WHERE pa.org_id = org_snapshot.org_id
            AND pa.classification = 'known' AND p.is_minor = 1),
       unknown_kids = (
         SELECT COUNT(*) FROM person_activity pa JOIN pco_people p
                ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
          WHERE pa.org_id = org_snapshot.org_id
            AND pa.classification = 'unknown' AND p.is_minor = 1)
 WHERE EXISTS (SELECT 1 FROM person_activity
                WHERE org_id = org_snapshot.org_id);

INSERT OR IGNORE INTO _migrations (filename)
VALUES ('0110_vocabulary_written_back.sql');
COMMIT;
