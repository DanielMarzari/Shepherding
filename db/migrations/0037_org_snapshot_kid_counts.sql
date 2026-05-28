-- Per-classification kid counts in the org snapshot. Previously the
-- fast path in getClassificationCounts ran a 33k-row JOIN of
-- person_activity → pco_people grouped by classification + is_minor
-- on every page render that needed the kids split (which is most of
-- /home and /people). Storing the four sub-counts in the snapshot
-- means the fast path is one indexed singleton-row read again.
ALTER TABLE org_snapshot ADD COLUMN shepherded_kids INTEGER NOT NULL DEFAULT 0;
ALTER TABLE org_snapshot ADD COLUMN active_kids INTEGER NOT NULL DEFAULT 0;
ALTER TABLE org_snapshot ADD COLUMN present_kids INTEGER NOT NULL DEFAULT 0;
ALTER TABLE org_snapshot ADD COLUMN inactive_kids INTEGER NOT NULL DEFAULT 0;
