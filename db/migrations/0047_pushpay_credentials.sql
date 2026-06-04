-- PushPay (giving platform) API credentials, stored the same way as PCO
-- creds: each secret AES-256-GCM encrypted at rest with the app
-- ENCRYPTION_KEY, plus a last-4 fingerprint for display. Nothing is
-- wired to PushPay's API yet — this just securely captures the
-- credentials so the sync can be built once they're available.
CREATE TABLE IF NOT EXISTS pushpay_credentials (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  client_id_enc TEXT,
  client_id_last4 TEXT,
  client_secret_enc TEXT,
  client_secret_last4 TEXT,
  -- PushPay organization / merchant key (optional until we know the
  -- exact integration shape).
  org_key_enc TEXT,
  org_key_last4 TEXT,
  organization_name TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
