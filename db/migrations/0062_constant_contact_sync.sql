-- Constant Contact data sync: contacts, lists, campaigns and per-contact
-- engagement, linked to PCO people by the same email HMAC we already store in
-- pco_person_emails. No plaintext email is kept — only the hash (join key).
-- Sync model mirrors PCO: a deep sync once, then a rolling 3-month
-- updated_after lookback; a full refresh resets the cursor + activity marks.

CREATE TABLE IF NOT EXISTS cc_sync_cursor (
  org_id INTEGER NOT NULL,
  resource TEXT NOT NULL,
  last_updated_at TEXT,
  last_synced_at TEXT,
  PRIMARY KEY (org_id, resource)
);

CREATE TABLE IF NOT EXISTS cc_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT,
  status TEXT,
  full_refresh INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS cc_lists (
  org_id INTEGER NOT NULL,
  list_id TEXT NOT NULL,
  name TEXT,
  membership_count INTEGER,
  favorite INTEGER,
  created_at TEXT,
  updated_at TEXT,
  synced_at TEXT,
  PRIMARY KEY (org_id, list_id)
);

CREATE TABLE IF NOT EXISTS cc_contacts (
  org_id INTEGER NOT NULL,
  contact_id TEXT NOT NULL,
  email_hash TEXT,            -- HMAC of the lowercased email (join key to PCO)
  person_id TEXT,            -- resolved pco_people.pco_id, if matched
  permission_to_send TEXT,   -- explicit / implicit / pending / unsubscribed / …
  opt_in_source TEXT,
  opt_in_date TEXT,
  opt_out_date TEXT,
  create_source TEXT,
  created_at TEXT,
  updated_at TEXT,
  synced_at TEXT,
  PRIMARY KEY (org_id, contact_id)
);
CREATE INDEX IF NOT EXISTS cc_contacts_hash ON cc_contacts(org_id, email_hash);
CREATE INDEX IF NOT EXISTS cc_contacts_person ON cc_contacts(org_id, person_id);

CREATE TABLE IF NOT EXISTS cc_contact_lists (
  org_id INTEGER NOT NULL,
  contact_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (org_id, contact_id, list_id)
);

CREATE TABLE IF NOT EXISTS cc_campaigns (
  org_id INTEGER NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_activity_id TEXT,  -- primary_email activity id (stats + tracking key)
  name TEXT,
  current_status TEXT,
  type TEXT,
  created_at TEXT,
  updated_at TEXT,
  activity_synced_at TEXT,    -- when we last pulled per-contact tracking
  synced_at TEXT,
  PRIMARY KEY (org_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS cc_campaigns_activity ON cc_campaigns(org_id, campaign_activity_id);

CREATE TABLE IF NOT EXISTS cc_campaign_stats (
  org_id INTEGER NOT NULL,
  campaign_activity_id TEXT NOT NULL,
  sends INTEGER, opens INTEGER, unique_opens INTEGER,
  clicks INTEGER, unique_clicks INTEGER,
  bounces INTEGER, opt_outs INTEGER, abuse INTEGER,
  did_not_open INTEGER, forwards INTEGER,
  updated_at TEXT,
  PRIMARY KEY (org_id, campaign_activity_id)
);

CREATE TABLE IF NOT EXISTS cc_campaign_lists (
  org_id INTEGER NOT NULL,
  campaign_activity_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (org_id, campaign_activity_id, list_id)
);

CREATE TABLE IF NOT EXISTS cc_contact_activity (
  org_id INTEGER NOT NULL,
  campaign_activity_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,   -- open / click / bounce / optout / send / forward
  activity_time TEXT,
  link_url TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (org_id, campaign_activity_id, contact_id, activity_type, link_url)
);
CREATE INDEX IF NOT EXISTS cc_activity_contact ON cc_contact_activity(org_id, contact_id, activity_type);
CREATE INDEX IF NOT EXISTS cc_activity_campaign ON cc_contact_activity(org_id, campaign_activity_id, activity_type);
