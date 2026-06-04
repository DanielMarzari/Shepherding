-- Version stamp on the duplicate-pair cache so a change to the scoring
-- logic forces a one-time rebuild on next view (instead of waiting for
-- the next sync). ensureDuplicatePairs compares this to the code's
-- CURRENT_DUP_VERSION and rebuilds when they differ.
ALTER TABLE duplicate_pairs_meta ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
