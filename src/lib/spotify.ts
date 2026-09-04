import "server-only";
import { getDb } from "./db";
import { decrypt, encrypt, last4 } from "./encryption";

// Spotify credential storage + the two public-data calls the Worship - Original
// Music report needs. Mirrors the PCO / PushPay credential pattern: secrets are
// AES-256-GCM encrypted at rest under ENCRYPTION_KEY, and only a last-4
// fingerprint is ever handed back to the UI.
//
// Auth is the client-credentials flow — an app token, not a user token. It
// reaches public catalogue data (artist, albums, tracks, follower count) and
// nothing belonging to a person, so there is no user consent step and no
// redirect URI in play, whatever the Spotify dashboard asks for at app-creation
// time.
//
// What this deliberately CANNOT do, so nobody goes looking: monthly listeners,
// stream counts, downloads and listener demographics are not in the Web API at
// any tier. Listeners and per-track play counts are on the public artist page;
// everything else is Spotify for Artists only.

/** Faith Church Music. Prefilled so the settings page has a sensible default. */
export const DEFAULT_SPOTIFY_ARTIST_ID = "0uGQrDiryyi7PtrYRgoRz9";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
/** Spotify rejects limit=50 with "Invalid limit" for an app key in development
 *  mode; 10 is the largest that works. Measured, not guessed. */
const PAGE = 10;
const API_BASE = "https://api.spotify.com/v1";

export interface StoredSpotifyCreds {
  hasCreds: boolean;
  clientIdLast4: string | null;
  clientSecretLast4: string | null;
  artistId: string | null;
  artistName: string | null;
  followerCount: number | null;
  verifiedAt: string | null;
  updatedAt: string | null;
}

export function getStoredSpotifyCreds(orgId: number): StoredSpotifyCreds {
  const row = getDb()
    .prepare(
      `SELECT client_id_last4, client_secret_last4, artist_id, artist_name,
              follower_count, verified_at, updated_at
         FROM spotify_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        client_id_last4: string | null;
        client_secret_last4: string | null;
        artist_id: string | null;
        artist_name: string | null;
        follower_count: number | null;
        verified_at: string | null;
        updated_at: string | null;
      }
    | undefined;
  if (!row) {
    return {
      hasCreds: false,
      clientIdLast4: null,
      clientSecretLast4: null,
      artistId: null,
      artistName: null,
      followerCount: null,
      verifiedAt: null,
      updatedAt: null,
    };
  }
  return {
    hasCreds: !!(row.client_id_last4 && row.client_secret_last4),
    clientIdLast4: row.client_id_last4,
    clientSecretLast4: row.client_secret_last4,
    artistId: row.artist_id,
    artistName: row.artist_name,
    followerCount: row.follower_count,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

/** Decrypted credentials — for the sync layer. Never send these to a client. */
export function getDecryptedSpotifyCreds(
  orgId: number,
): { clientId: string; clientSecret: string; artistId: string } | null {
  const row = getDb()
    .prepare(
      `SELECT client_id_enc, client_secret_enc, artist_id
         FROM spotify_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | { client_id_enc: string | null; client_secret_enc: string | null; artist_id: string | null }
    | undefined;
  if (!row?.client_id_enc || !row.client_secret_enc) return null;
  return {
    clientId: decrypt(row.client_id_enc),
    clientSecret: decrypt(row.client_secret_enc),
    artistId: row.artist_id || DEFAULT_SPOTIFY_ARTIST_ID,
  };
}

export function saveSpotifyCreds(
  orgId: number,
  clientId: string,
  clientSecret: string,
  artistId: string,
) {
  getDb()
    .prepare(
      `INSERT INTO spotify_credentials
         (org_id, client_id_enc, client_id_last4, client_secret_enc,
          client_secret_last4, artist_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         client_id_enc = excluded.client_id_enc,
         client_id_last4 = excluded.client_id_last4,
         client_secret_enc = excluded.client_secret_enc,
         client_secret_last4 = excluded.client_secret_last4,
         artist_id = excluded.artist_id,
         -- A new key has not been proven to work yet; the caller re-verifies.
         artist_name = NULL,
         follower_count = NULL,
         verified_at = NULL,
         updated_at = excluded.updated_at`,
    )
    .run(
      orgId,
      encrypt(clientId),
      last4(clientId),
      encrypt(clientSecret),
      last4(clientSecret),
      artistId,
      new Date().toISOString(),
    );
}

export function deleteSpotifyCreds(orgId: number) {
  getDb().prepare("DELETE FROM spotify_credentials WHERE org_id = ?").run(orgId);
}

function markVerified(orgId: number, artistName: string, followers: number | null) {
  getDb()
    .prepare(
      `UPDATE spotify_credentials
          SET artist_name = ?, follower_count = ?, verified_at = ?
        WHERE org_id = ?`,
    )
    .run(artistName, followers, new Date().toISOString(), orgId);
}

// ─── Spotify Web API ─────────────────────────────────────────────────

/** Why a Spotify call failed. The distinction is load-bearing: a rejected key
 *  means don't overwrite what's stored, while an unreachable Spotify means we
 *  genuinely cannot tell whether the new key is good. */
export type SpotifyFailure = "auth" | "not-found" | "unavailable";

export class SpotifyError extends Error {
  readonly kind: SpotifyFailure;
  constructor(message: string, kind: SpotifyFailure) {
    super(message);
    this.name = "SpotifyError";
    this.kind = kind;
  }
}

/** fetch() that reports a transport failure as `unavailable` rather than
 *  letting Node's bare "fetch failed" reach an admin as if it were their typo. */
async function spotifyFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new SpotifyError(
      "Couldn't reach Spotify — the network request failed. This is not a problem with your credentials.",
      "unavailable",
    );
  }
}

export interface SpotifyArtist {
  id: string;
  name: string;
  /** null when Spotify omitted the field — which it does for app keys in
   *  development mode. NOT the same as "this artist has no followers", and the
   *  UI must not render it as 0. */
  followers: number | null;
  popularity: number | null;
}

/** Exchange the app credentials for a bearer token (client-credentials flow).
 *  Throws with a message safe to show an admin — never echoes the secret. */
async function getAppToken(clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await spotifyFetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    // 400 invalid_client is by far the common case: a typo, or the secret was
    // rotated in the dashboard. Say that rather than dumping Spotify's JSON —
    // which can echo the request back, secret included.
    if (res.status === 400 || res.status === 401) {
      throw new SpotifyError(
        "Spotify rejected the Client ID / Secret. Check both were copied whole from the app's Settings page.",
        "auth",
      );
    }
    if (res.status === 429) {
      throw new SpotifyError(
        "Spotify is rate-limiting us right now. Wait a minute and try again — your credentials are fine.",
        "unavailable",
      );
    }
    throw new SpotifyError(
      `Spotify is not responding normally (HTTP ${res.status}). That's their end, not your credentials.`,
      "unavailable",
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new SpotifyError("Spotify returned no access token.", "unavailable");
  }
  return json.access_token;
}

/** Fetch one artist's public profile. */
async function fetchArtist(token: string, artistId: string): Promise<SpotifyArtist> {
  const res = await spotifyFetch(`${API_BASE}/artists/${encodeURIComponent(artistId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404 || res.status === 400) {
    throw new SpotifyError(`No Spotify artist with ID "${artistId}".`, "not-found");
  }
  if (!res.ok) {
    throw new SpotifyError(
      `Spotify is not responding normally (HTTP ${res.status}). That's their end, not your credentials.`,
      "unavailable",
    );
  }
  const a = (await res.json()) as {
    id: string;
    name: string;
    followers?: { total?: number };
    popularity?: number;
  };
  return {
    id: a.id,
    name: a.name,
    // `?? null`, never `?? 0`: Spotify omits `followers` entirely for keys in
    // development mode, and a zero here is a lie an admin can't tell from data.
    followers: a.followers?.total ?? null,
    popularity: a.popularity ?? null,
  };
}

/** Prove a candidate set of credentials works AND reaches the given artist,
 *  WITHOUT touching what is stored. The action calls this before writing, so a
 *  mistyped secret can't overwrite a working one. A valid key pointed at the
 *  wrong artist is a silent failure, hence returning the artist. */
export async function verifyCredentials(
  clientId: string,
  clientSecret: string,
  artistId: string,
): Promise<SpotifyArtist> {
  const token = await getAppToken(clientId, clientSecret);
  return fetchArtist(token, artistId);
}

/** Record that a set of credentials was proven to reach this artist. */
export function markSpotifyVerified(orgId: number, artist: SpotifyArtist) {
  markVerified(orgId, artist.name, artist.followers);
}

/** Re-check what is already stored (the "Re-check" button). */
export async function verifySpotifyCreds(orgId: number): Promise<SpotifyArtist> {
  const creds = getDecryptedSpotifyCreds(orgId);
  if (!creds) throw new SpotifyError("No Spotify credentials stored.", "auth");
  const artist = await verifyCredentials(creds.clientId, creds.clientSecret, creds.artistId);
  markVerified(orgId, artist.name, artist.followers);
  return artist;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  albumId: string;
  album: string;
  albumType: string;
  releasedOn: string;
}

/** Every track the artist has released, across all albums, singles and EPs.
 *  This is what answers "# songs released" on the report, and is the
 *  authoritative title list to check the service-plan matching against. */
export async function fetchSpotifyCatalogue(orgId: number): Promise<SpotifyTrack[]> {
  const creds = getDecryptedSpotifyCreds(orgId);
  if (!creds) throw new Error("No Spotify credentials stored.");
  const token = await getAppToken(creds.clientId, creds.clientSecret);

  // include_groups takes album,single,appears_on,compilation — there is no "ep"
  // value; Spotify files EPs under `single`. appears_on is excluded on purpose:
  // it is other artists' records, not ours.
  const albums: Array<{
    id: string; name: string; release_date: string; album_type: string;
  }> = [];
  for (let offset = 0; offset < 500; offset += PAGE) {
    const res = await spotifyFetch(
      `${API_BASE}/artists/${encodeURIComponent(creds.artistId)}/albums` +
        `?include_groups=album,single,compilation&limit=${PAGE}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new SpotifyError(`Spotify albums request failed (HTTP ${res.status}).`, "unavailable");
    }
    const json = (await res.json()) as {
      items?: Array<{ id: string; name: string; release_date: string; album_type: string }>;
      next?: string | null;
    };
    albums.push(...(json.items ?? []));
    if (!json.next) break;
  }

  const tracks: SpotifyTrack[] = [];
  const seen = new Set<string>();
  for (const album of albums) {
    for (let offset = 0; offset < 500; offset += PAGE) {
      const res = await spotifyFetch(
        `${API_BASE}/albums/${album.id}/tracks?limit=${PAGE}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        throw new SpotifyError(
          `Could not read the tracks of "${album.name}" (HTTP ${res.status}).`,
          "unavailable",
        );
      }
      const json = (await res.json()) as {
        items?: Array<{ id: string; name: string }>;
        next?: string | null;
      };
      for (const t of json.items ?? []) {
        // The same recording can appear on both an album and a single; key on
        // title so "# songs released" counts songs, not appearances.
        const key = t.name.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        tracks.push({
          id: t.id,
          name: t.name,
          albumId: album.id,
          album: album.name,
          albumType: album.album_type,
          releasedOn: album.release_date,
        });
      }
      if (!json.next) break;
    }
  }
  return tracks.sort((a, b) => a.name.localeCompare(b.name));
}

/** Replace the stored catalogue with what Spotify currently returns. Done as a
 *  delete+insert inside one transaction: a track pulled from distribution
 *  should disappear here too, and a half-written catalogue would make
 *  "# songs released" wrong in a way nobody would notice. */
export function replaceSpotifyCatalogue(orgId: number, tracks: SpotifyTrack[]): number {
  const db = getDb();
  const run = db.transaction((rows: SpotifyTrack[]) => {
    db.prepare("DELETE FROM spotify_tracks WHERE org_id = ?").run(orgId);
    const ins = db.prepare(
      `INSERT INTO spotify_tracks
         (org_id, track_id, name, album_id, album_name, album_type, released_on)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of rows) {
      ins.run(orgId, t.id, t.name, t.albumId, t.album, t.albumType, t.releasedOn);
    }
  });
  run(tracks);
  return tracks.length;
}

/** Pull the catalogue from Spotify and store it. Returns how many tracks. */
export async function syncSpotifyCatalogue(orgId: number): Promise<number> {
  return replaceSpotifyCatalogue(orgId, await fetchSpotifyCatalogue(orgId));
}
