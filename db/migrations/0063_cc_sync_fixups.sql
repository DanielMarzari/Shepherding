-- Constant Contact sync fix-ups after probing the live v3 API:
--  * Campaign summaries are keyed by campaign_id (not campaign_activity_id) with
--    stats under `unique_counts` — so fold stats into cc_campaigns by campaign_id
--    and drop the mis-keyed stats table.
--  * Per-contact tracking lives at /reports/email_reports/{activity_id}/tracking.
--  * Add a CC auto-sync schedule (mirrors PCO's pco_sync_settings).

DROP TABLE IF EXISTS cc_campaign_stats;

ALTER TABLE cc_campaigns ADD COLUMN last_sent_date TEXT;
ALTER TABLE cc_campaigns ADD COLUMN stat_sends INTEGER;
ALTER TABLE cc_campaigns ADD COLUMN stat_opens INTEGER;       -- unique opens
ALTER TABLE cc_campaigns ADD COLUMN stat_clicks INTEGER;      -- unique clicks
ALTER TABLE cc_campaigns ADD COLUMN stat_bounces INTEGER;
ALTER TABLE cc_campaigns ADD COLUMN stat_optouts INTEGER;
ALTER TABLE cc_campaigns ADD COLUMN stat_forwards INTEGER;
ALTER TABLE cc_campaigns ADD COLUMN stat_abuse INTEGER;
ALTER TABLE cc_campaigns ADD COLUMN stat_not_opened INTEGER;
ALTER TABLE cc_campaigns ADD COLUMN stats_updated_at TEXT;
CREATE INDEX IF NOT EXISTS cc_campaigns_sent ON cc_campaigns(org_id, last_sent_date);

CREATE TABLE IF NOT EXISTS cc_sync_settings (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'daily',      -- daily | weekly | monthly
  run_at_hour INTEGER NOT NULL DEFAULT 3,
  run_at_dow INTEGER NOT NULL DEFAULT 1,        -- 0=Sun … 6=Sat (weekly)
  run_at_dom INTEGER NOT NULL DEFAULT 1,        -- day of month (monthly)
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
