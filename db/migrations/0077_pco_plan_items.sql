-- Service-order items (the plan "order of service") for the worship service
-- types. Each plan (a Sunday service) has an ordered list of items — headers,
-- songs, and "item" rows. The announcement / communications items carry, in
-- their description + html_details, what was promoted from the stage that
-- week: giving, prayer nights, small-group launches, Discover classes, serve
-- pushes, campaigns, invites. That's the raw material for the "what did we
-- ask people to do, and did anything move?" correlation.
--
-- Synced only for the worship service types (see WORSHIP_SERVICE_TYPE_IDS in
-- pco-sync-services.ts) — pulling items for all 48 service types would be huge
-- and pointless. First sync backfills history; nightly refreshes a rolling
-- 6-week window (announcements get edited right up to service day).
CREATE TABLE IF NOT EXISTS pco_plan_items (
  org_id          INTEGER NOT NULL,
  pco_id          TEXT    NOT NULL,   -- PCO Item id
  plan_id         TEXT    NOT NULL,   -- PCO Plan id (→ pco_plans.pco_id)
  service_type_id TEXT,
  sequence        INTEGER,            -- order within the service
  item_type       TEXT,              -- 'header' | 'song' | 'item' | 'media'
  title           TEXT,
  description      TEXT,
  html_details     TEXT,
  length           INTEGER,           -- seconds
  synced_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, pco_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON pco_plan_items(org_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_st ON pco_plan_items(org_id, service_type_id);
