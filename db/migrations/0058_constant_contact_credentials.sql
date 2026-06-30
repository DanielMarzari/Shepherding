-- Constant Contact (email marketing) API credentials, stored the same way as
-- PCO / PushPay: each secret AES-256-GCM encrypted at rest with the app
-- ENCRYPTION_KEY, plus a last-4 fingerprint for display. Nothing is wired to
-- Constant Contact's v3 API yet — this just securely captures the credentials
-- so the targeted-email + open/click-tracking sync can be built later.
-- (v3 uses OAuth2: an API Key + App Secret register the app; a refresh token
-- mints access tokens for sending and pulling per-contact engagement.)
CREATE TABLE IF NOT EXISTS constantcontact_credentials (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_enc TEXT,
  api_key_last4 TEXT,
  app_secret_enc TEXT,
  app_secret_last4 TEXT,
  -- Optional until the OAuth flow is built.
  refresh_token_enc TEXT,
  refresh_token_last4 TEXT,
  organization_name TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
