-- Credentials for integrations that do not have a sync yet.
--
-- PCO, PushPay, Constant Contact, Subsplash and Spotify each own a table with
-- provider-shaped columns, because each has a distinct credential shape and a
-- sync built around it. This table is for the other direction: a place to
-- capture a credential the moment it exists, for an integration nobody has
-- written yet, without a migration per provider.
--
-- It exists because four published Outputs across the Communications reports
-- are waiting on connections that have not been made — app downloads (App
-- Store Connect and Google Play), YouTube subscribers, and Instagram reach —
-- and there was nowhere to record a key when one turns up. See
-- INTEGRATIONS in src/lib/integrations.ts for what each provider needs and
-- which Outputs it would fill.
--
-- One row per FIELD, so a provider needing three secrets (issuer id, key id,
-- private key) is three rows rather than a schema change. Values are
-- AES-256-GCM encrypted with the same ENCRYPTION_KEY as every other secret;
-- value_last4 is kept unencrypted purely so the UI can show which key is
-- stored without decrypting it.
CREATE TABLE IF NOT EXISTS integration_credentials (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  field TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  value_last4 TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, provider, field)
);
CREATE INDEX IF NOT EXISTS integration_credentials_provider
  ON integration_credentials(org_id, provider);
