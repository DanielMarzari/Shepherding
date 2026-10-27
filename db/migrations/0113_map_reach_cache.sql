-- The reach analysis, worked out once instead of per request.
--
-- analyzeReach reads every geocoded home, then sites a second campus for
-- four cohorts, each one walking a geometric median over up to 23,986
-- points. Measured on production: 1.4s of queries and 3.3s of arithmetic,
-- on every load of /map and /next-campus-planner, for an answer that only
-- changes when homes are geocoded or the snapshot is rebuilt.
--
-- The answer is kept here as JSON against a signature of its inputs. When
-- the signature still matches, the page reads one row.

CREATE TABLE IF NOT EXISTS map_reach_cache (
  org_id     INTEGER NOT NULL,
  max_hours  REAL    NOT NULL,
  -- Point count, newest geocode, drive-row count and the snapshot's
  -- refresh stamp. Any of them moving means the answer may have moved.
  signature  TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  built_ms   INTEGER NOT NULL DEFAULT 0,
  built_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, max_hours)
);

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0113_map_reach_cache.sql');
