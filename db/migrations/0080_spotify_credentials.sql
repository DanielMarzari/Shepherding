-- Spotify app credentials, for the Worship - Original Music ministry report.
-- Same shape as pco_credentials / pushpay_credentials: the id and secret are
-- AES-256-GCM encrypted at rest under ENCRYPTION_KEY and only a last-4
-- fingerprint is ever shown back.
--
-- We use the client-credentials flow (server-to-server, public catalogue data),
-- so there is no user OAuth, no refresh token, and no redirect URI to store —
-- Spotify's dashboard demands one when you create the app, but it is never used.
--
-- artist_id is the artist whose catalogue the report counts (Faith Church
-- Music). artist_name and follower_count are filled in when the credentials are
-- verified, so the settings page can show that the key reaches the right artist.
CREATE TABLE IF NOT EXISTS spotify_credentials (
  org_id              INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  client_id_enc       TEXT,
  client_id_last4     TEXT,
  client_secret_enc   TEXT,
  client_secret_last4 TEXT,
  artist_id           TEXT,
  artist_name         TEXT,
  follower_count      INTEGER,
  -- Set when a token was successfully exchanged AND the artist fetched.
  verified_at         TEXT,
  updated_at          TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
