-- Outreach becomes a real lane, and giving joins the snapshot.
--
-- person_activity has carried in_worship_lane / in_community_lane /
-- in_serving_lane since it was introduced, which left the membership audit
-- unable to answer "is this member in any lane at all" without a 3.6 s
-- aggregate over the whole org. Giving and outreach are the two missing
-- flags; with them the audit is a single-table read (~25 ms).
--
-- Outreach is not derivable the way the others are. There is no "outreach"
-- flag anywhere in PCO — the ministries that count locally are ELM, the
-- prayer teams, ESL, Foster/Adopt, On Mission Sports, Community Partners,
-- Unleashing Servants Projects. So it is configured, not inferred: two JSON
-- arrays of pco ids, picked in /pco/filters, exactly like excluded_team_types
-- and excluded_group_types already work. Empty or NULL means "nothing is
-- tagged as outreach yet", and in_outreach_lane stays 0 for everyone —
-- an honest empty lane rather than a guessed one.

BEGIN IMMEDIATE;

ALTER TABLE person_activity ADD COLUMN in_giving_lane INTEGER NOT NULL DEFAULT 0;
ALTER TABLE person_activity ADD COLUMN in_outreach_lane INTEGER NOT NULL DEFAULT 0;

-- Service types (what the UI calls team types) whose teams count as outreach.
ALTER TABLE pco_sync_settings ADD COLUMN outreach_service_types TEXT;
-- Group types whose groups count as outreach.
ALTER TABLE pco_sync_settings ADD COLUMN outreach_group_types TEXT;

-- Both flags are filled by the next dashboard refresh (nightly, or the
-- "Refresh now" button). Until then they read 0 for everyone, which is why
-- the audit page shows its own "snapshot last rebuilt" line rather than
-- quietly presenting a half-filled lane as fact.

CREATE INDEX IF NOT EXISTS person_activity_lanes
  ON person_activity(org_id, in_worship_lane, in_serving_lane,
                     in_community_lane, in_giving_lane, in_outreach_lane);

INSERT OR IGNORE INTO _migrations (filename) VALUES ('0103_outreach_lane.sql');
COMMIT;
