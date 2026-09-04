-- The artist's released catalogue, pulled from the Spotify Web API so the
-- Worship - Original Music report can answer "# songs released" / "# songs
-- produced" from the source of truth rather than a hand-kept list.
--
-- Stored rather than fetched per render: the report is a set of SQL blocks in
-- the page builder, which read the database and cannot call an API.
CREATE TABLE IF NOT EXISTS spotify_tracks (
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- The release it belongs to. Spotify calls a 4-track record a "single" if the
  -- label registered it that way, so album_type is its word, not ours.
  album_id    TEXT,
  album_name  TEXT,
  album_type  TEXT,
  released_on TEXT,
  synced_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, track_id)
);

CREATE INDEX IF NOT EXISTS spotify_tracks_org ON spotify_tracks(org_id);

-- Follower count was stored as an INTEGER defaulting to 0, which meant "Spotify
-- did not report it" and "this artist has no followers" looked identical on the
-- page. It is nullable and NULL means unknown; the UI says so rather than
-- printing a zero nobody should believe.
UPDATE spotify_credentials SET follower_count = NULL WHERE follower_count = 0;
