import "server-only";
import { getDb } from "./db";
import { decrypt, encrypt, last4 } from "./encryption";

// Constant Contact credential storage. Mirrors the PCO / PushPay pattern:
// secrets are AES-256-GCM encrypted at rest (same ENCRYPTION_KEY), with a
// last-4 fingerprint kept for display. No Constant Contact API calls happen
// yet — this is just secure capture so the email sync can be wired up later.

export interface StoredConstantContactCreds {
  hasCreds: boolean;
  apiKeyLast4: string | null;
  appSecretLast4: string | null;
  refreshTokenLast4: string | null;
  organizationName: string | null;
  /** Set once a real connection is verified — null until the API is wired. */
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
      apiKeyLast4: null,
      appSecretLast4: null,
      refreshTokenLast4: null,
      organizationName: null,
      verifiedAt: null,
      updatedAt: null,
    };
  }
  return {
    hasCreds: !!(row.api_key_last4 && row.app_secret_last4),
    apiKeyLast4: row.api_key_last4,
    appSecretLast4: row.app_secret_last4,
    refreshTokenLast4: row.refresh_token_last4,
    organizationName: row.organization_name,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

/** Decrypted credentials — for the future sync layer. */
export function getDecryptedConstantContactCreds(orgId: number): {
  apiKey: string;
  appSecret: string;
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
  if (!row || !row.api_key_enc || !row.app_secret_enc) return null;
  return {
    apiKey: decrypt(row.api_key_enc),
    appSecret: decrypt(row.app_secret_enc),
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null,
  };
}

export function saveConstantContactCreds(
  orgId: number,
  apiKey: string,
  appSecret: string,
  refreshToken: string | null,
) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO constantcontact_credentials
         (org_id, api_key_enc, api_key_last4, app_secret_enc, app_secret_last4,
          refresh_token_enc, refresh_token_last4, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         api_key_enc = excluded.api_key_enc,
         api_key_last4 = excluded.api_key_last4,
         app_secret_enc = excluded.app_secret_enc,
         app_secret_last4 = excluded.app_secret_last4,
         refresh_token_enc = excluded.refresh_token_enc,
         refresh_token_last4 = excluded.refresh_token_last4,
         updated_at = excluded.updated_at`,
    )
    .run(
      orgId,
      encrypt(apiKey),
      last4(apiKey),
      encrypt(appSecret),
      last4(appSecret),
      refreshToken ? encrypt(refreshToken) : null,
      refreshToken ? last4(refreshToken) : null,
      now,
    );
}

export function deleteConstantContactCreds(orgId: number) {
  getDb().prepare("DELETE FROM constantcontact_credentials WHERE org_id = ?").run(orgId);
}
