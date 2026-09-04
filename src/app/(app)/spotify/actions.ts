"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  DEFAULT_SPOTIFY_ARTIST_ID,
  SpotifyError,
  deleteSpotifyCreds,
  markSpotifyVerified,
  saveSpotifyCreds,
  syncSpotifyCatalogue,
  verifyCredentials,
  verifySpotifyCreds,
} from "@/lib/spotify";

export interface SaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

/** Spotify artist IDs are base62, 22 characters. Accept either the raw ID or a
 *  pasted artist URL, because the URL is what you actually have in front of you
 *  when you're looking at the artist page. */
function parseArtistId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const fromUrl = s.match(/artist[/:]([A-Za-z0-9]{22})/);
  const id = fromUrl ? fromUrl[1] : s;
  return /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
}

export async function saveSpotifyCredentialsAction(
  _prev: SaveState | null,
  formData: FormData,
): Promise<SaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change Spotify credentials." };
  }

  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const artistRaw = String(formData.get("artistId") ?? "").trim() || DEFAULT_SPOTIFY_ARTIST_ID;

  if (!clientId || !clientSecret) {
    return { status: "error", message: "Client ID and Client Secret are both required." };
  }
  const artistId = parseArtistId(artistRaw);
  if (!artistId) {
    return {
      status: "error",
      message:
        "That artist ID doesn't look right. Paste the 22-character ID, or the whole artist URL.",
    };
  }

  // Verify BEFORE writing. Saving first and checking afterwards means one
  // mistyped secret overwrites a working one and there is no undo — the admin
  // has to go back to the Spotify dashboard to recover a connection that was
  // fine a moment ago.
  let artist;
  try {
    artist = await verifyCredentials(clientId, clientSecret, artistId);
  } catch (err) {
    const kind = err instanceof SpotifyError ? err.kind : "unavailable";
    const message = err instanceof Error ? err.message : "Could not reach Spotify.";

    if (kind === "auth" || kind === "not-found") {
      // Spotify is definite that these are wrong, so keep what we already have.
      return {
        status: "error",
        message: `${message} Nothing was changed — any credentials already stored are untouched.`,
      };
    }

    // Spotify is unreachable, so we genuinely cannot tell whether the new key is
    // good. Storing it unverified beats discarding what the admin just typed.
    try {
      saveSpotifyCreds(s.orgId, clientId, clientSecret, artistId);
    } catch (saveErr) {
      return {
        status: "error",
        message:
          "Could not store the credentials: " +
          (saveErr instanceof Error ? saveErr.message : "unknown error") +
          ". Nothing was saved.",
      };
    }
    revalidatePath("/spotify");
    return {
      status: "error",
      message: `${message} The credentials were saved but not checked — use Re-check once Spotify is reachable.`,
    };
  }

  // Proven good: store them, and record what they reached.
  try {
    saveSpotifyCreds(s.orgId, clientId, clientSecret, artistId);
    markSpotifyVerified(s.orgId, artist);
  } catch (err) {
    // A misconfigured ENCRYPTION_KEY throws here, and an uncaught throw in a
    // server action white-screens the settings page. An admin who cannot read
    // an error cannot fix one.
    return {
      status: "error",
      message:
        "Could not store the credentials: " +
        (err instanceof Error ? err.message : "unknown error") +
        ". Nothing was saved.",
    };
  }

  revalidatePath("/spotify");
  return {
    status: "saved",
    message: `Connected to ${artist.name}. ${describeFollowers(artist.followers)}`,
  };
}

/** Spotify omits `followers` entirely for an app key in development mode. Say
 *  that, rather than printing a zero the admin knows is wrong — they follow the
 *  artist themselves. */
function describeFollowers(followers: number | null): string {
  if (followers === null) {
    return "Spotify didn't report a follower count for this key — see the note below.";
  }
  return `${followers.toLocaleString()} follower${followers === 1 ? "" : "s"}.`;
}

/** Re-check stored credentials without re-entering them (they rotate, and a key
 *  can be revoked in the dashboard long after it was saved here). */
export async function verifySpotifyCredentialsAction(): Promise<SaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") return { status: "error", message: "Admin only." };
  try {
    const artist = await verifySpotifyCreds(s.orgId);
    revalidatePath("/spotify");
    return {
      status: "saved",
      message: `Still connected to ${artist.name}. ${describeFollowers(artist.followers)}`,
    };
  } catch (err) {
    revalidatePath("/spotify");
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Could not reach Spotify.",
    };
  }
}

export async function removeSpotifyCredentialsAction() {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  deleteSpotifyCreds(s.orgId);
  revalidatePath("/spotify");
}

export interface SyncState {
  status: "idle" | "ok" | "error";
  message?: string;
}

/** Pull the released catalogue from Spotify into the database, so the
 *  Original Music report can count it. */
export async function syncSpotifyCatalogueAction(): Promise<SyncState> {
  const s = await requireOrg();
  if (s.role !== "admin") return { status: "error", message: "Admin only." };
  try {
    const n = await syncSpotifyCatalogue(s.orgId);
    revalidatePath("/spotify");
    revalidatePath("/builder/mir-worship-original-music");
    return {
      status: "ok",
      message: `Catalogue synced — ${n} released track${n === 1 ? "" : "s"}.`,
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Could not read the catalogue.",
    };
  }
}
