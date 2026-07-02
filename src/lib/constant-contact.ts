import "server-only";
import crypto from "node:crypto";
import { getDb } from "./db";
import { decrypt, encrypt, last4 } from "./encryption";

// Constant Contact credential storage. Mirrors the PCO / PushPay pattern:
// secrets are AES-256-GCM encrypted at rest (same ENCRYPTION_KEY), with a
// last-4 fingerprint kept for display. No Constant Contact API calls happen
// yet — this is just secure capture so the email sync can be wired up later.

export interface StoredConstantContactCreds {
  /** An API key is stored (enough to start the OAuth Connect flow). */
  hasCreds: boolean;
  /** OAuth is complete — we hold a refresh token and can call the API. */
  connected: boolean;
  apiKeyLast4: string | null;
  appSecretLast4: string | null;
  refreshTokenLast4: string | null;
  organizationName: string | null;
  /** Set once the OAuth connection succeeds. */
  verifiedAt: string | null;
  updatedAt: string | null;
}

export function getStoredConstantContactCreds(orgId: number): StoredConstantContactCreds {
  const row = getDb()
    .prepare(
      `SELECT api_key_last4, app_secret_last4, refresh_token_last4,
              organization_name, verified_at, updated_at
         FROM constantcontact_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        api_key_last4: string | null;
        app_secret_last4: string | null;
        refresh_token_last4: string | null;
        organization_name: string | null;
        verified_at: string | null;
        updated_at: string | null;
      }
    | undefined;
  if (!row) {
    return {
      hasCreds: false,
      connected: false,
      apiKeyLast4: null,
      appSecretLast4: null,
      refreshTokenLast4: null,
      organizationName: null,
      verifiedAt: null,
      updatedAt: null,
    };
  }
  return {
    hasCreds: !!row.api_key_last4,
    connected: !!row.refresh_token_last4,
    apiKeyLast4: row.api_key_last4,
    appSecretLast4: row.app_secret_last4,
    refreshTokenLast4: row.refresh_token_last4,
    organizationName: row.organization_name,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

/** Decrypted credentials — apiKey is required; appSecret is optional (PKCE
 *  public clients have none); refreshToken exists once OAuth completes. */
export function getDecryptedConstantContactCreds(orgId: number): {
  apiKey: string;
  appSecret: string | null;
  refreshToken: string | null;
} | null {
  const row = getDb()
    .prepare(
      `SELECT api_key_enc, app_secret_enc, refresh_token_enc
         FROM constantcontact_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        api_key_enc: string | null;
        app_secret_enc: string | null;
        refresh_token_enc: string | null;
      }
    | undefined;
  if (!row || !row.api_key_enc) return null;
  return {
    apiKey: decrypt(row.api_key_enc),
    appSecret: row.app_secret_enc ? decrypt(row.app_secret_enc) : null,
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null,
  };
}

/** Store the API key (+ optional app secret). Preserves any existing refresh
 *  token so re-saving the key doesn't drop an existing connection. */
export function saveConstantContactCreds(
  orgId: number,
  apiKey: string,
  appSecret: string | null,
) {
  const db = getDb();
  const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
  const exists = db.prepare("SELECT 1 FROM constantcontact_credentials WHERE org_id = ?").get(orgId);
  if (exists) {
    db.prepare(
      `UPDATE constantcontact_credentials
          SET api_key_enc = ?, api_key_last4 = ?, app_secret_enc = ?, app_secret_last4 = ?, updated_at = ${now}
        WHERE org_id = ?`,
    ).run(encrypt(apiKey), last4(apiKey), appSecret ? encrypt(appSecret) : null, appSecret ? last4(appSecret) : null, orgId);
  } else {
    db.prepare(
      `INSERT INTO constantcontact_credentials
         (org_id, api_key_enc, api_key_last4, app_secret_enc, app_secret_last4, updated_at)
       VALUES (?, ?, ?, ?, ?, ${now})`,
    ).run(orgId, encrypt(apiKey), last4(apiKey), appSecret ? encrypt(appSecret) : null, appSecret ? last4(appSecret) : null);
  }
}

/** Persist a refresh token from the OAuth callback / a rotation, marking the
 *  account connected. */
export function saveConstantContactRefreshToken(orgId: number, refreshToken: string): void {
  getDb()
    .prepare(
      `UPDATE constantcontact_credentials
          SET refresh_token_enc = ?, refresh_token_last4 = ?,
              verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE org_id = ?`,
    )
    .run(encrypt(refreshToken), last4(refreshToken), orgId);
}

// ─── OAuth2 (Authorization Code + PKCE) ──────────────────────────────
// Works for a PKCE public client (API key only) and a confidential client
// (API key + secret) alike: we always send PKCE, and add HTTP Basic auth only
// when an app secret is stored. Rotating refresh tokens are persisted
// automatically, so either refresh-token type works.

export const CC_AUTHORIZE_URL = "https://authz.constantcontact.com/oauth2/default/v1/authorize";
export const CC_TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token";
export const CC_SCOPES = "contact_data campaign_data offline_access";

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildCcAuthorizeUrl(clientId: string, redirectUri: string, state: string, codeChallenge: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CC_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${CC_AUTHORIZE_URL}?${p.toString()}`;
}

interface CcTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function ccTokenRequest(body: URLSearchParams, clientId: string, clientSecret: string | null): Promise<CcTokenResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  // Supply client credentials exactly ONE way, or Okta rejects with "Cannot
  // supply multiple client credentials": Basic header for a confidential client
  // (has a secret), otherwise client_id in the body for a PKCE public client.
  body.delete("client_id");
  if (clientSecret) {
    headers.Authorization = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  } else {
    body.set("client_id", clientId);
  }
  let res: Response;
  try {
    res = await fetch(CC_TOKEN_URL, { method: "POST", headers, body });
  } catch (e) {
    return { error: "network_error", error_description: e instanceof Error ? e.message : "request failed" };
  }
  const json = (await res.json().catch(() => ({}))) as CcTokenResponse;
  if (!res.ok) return { error: json.error || `http_${res.status}`, error_description: json.error_description };
  return json;
}

/** Exchange an authorization code for tokens and store the refresh token. */
export async function exchangeCcCode(
  orgId: number,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const creds = getDecryptedConstantContactCreds(orgId);
  if (!creds) return { ok: false, error: "No Constant Contact API key stored." };
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: creds.apiKey,
    code_verifier: codeVerifier,
  });
  const t = await ccTokenRequest(body, creds.apiKey, creds.appSecret);
  if (t.error || !t.refresh_token) {
    return { ok: false, error: t.error_description || t.error || "No refresh token returned by Constant Contact." };
  }
  saveConstantContactRefreshToken(orgId, t.refresh_token);
  return { ok: true };
}

const ccAccessCache = new Map<number, { token: string; exp: number }>();

/** A valid access token for API calls — refreshed from the stored refresh
 *  token, cached until shortly before expiry. Persists a rotated refresh
 *  token if Constant Contact returns one. */
export async function getCcAccessToken(orgId: number): Promise<string | null> {
  const cached = ccAccessCache.get(orgId);
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const creds = getDecryptedConstantContactCreds(orgId);
  if (!creds || !creds.refreshToken) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: creds.apiKey,
  });
  const t = await ccTokenRequest(body, creds.apiKey, creds.appSecret);
  if (t.error || !t.access_token) return null;
  if (t.refresh_token && t.refresh_token !== creds.refreshToken) saveConstantContactRefreshToken(orgId, t.refresh_token);
  ccAccessCache.set(orgId, { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 });
  return t.access_token;
}

// ─── API reads ───────────────────────────────────────────────────────
export const CC_API_BASE = "https://api.cc.email/v3";

export type CcApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** GET a Constant Contact v3 API path with a fresh bearer token. */
export async function ccApiGet<T = unknown>(orgId: number, path: string): Promise<CcApiResult<T>> {
  const token = await getCcAccessToken(orgId);
  if (!token) return { ok: false, status: 401, error: "Not connected to Constant Contact." };
  let res: Response;
  try {
    res = await fetch(`${CC_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "request failed" };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 400) || res.statusText };
  }
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: true, data };
}

export function deleteConstantContactCreds(orgId: number) {
  getDb().prepare("DELETE FROM constantcontact_credentials WHERE org_id = ?").run(orgId);
}
