-- Subsplash (church app) API credentials, stored the same way as PCO /
-- PushPay: each secret AES-256-GCM encrypted at rest with the app
-- ENCRYPTION_KEY, plus a last-4 fingerprint for display. Nothing is wired to
-- Subsplash's API yet — this just securely captures the credentials so the
-- Engagement API sync (app opens, content consumption, push tokens) can be
-- built later and fed into person_activity as intent signals.
CREATE TABLE IF NOT EXISTS subsplash_credentials (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_enc TEXT,
  api_key_last4 TEXT,
  -- Optional, depending on Subsplash's auth shape / our access tier.
  client_secret_enc TEXT,
  client_secret_last4 TEXT,
  app_id_enc TEXT,
  app_id_last4 TEXT,
  organization_name TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
