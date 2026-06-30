import "server-only";
import { getDb } from "./db";
import { decrypt, encrypt, last4 } from "./encryption";

// Subsplash credential storage. Mirrors the PCO / PushPay pattern: secrets are
// AES-256-GCM encrypted at rest (same ENCRYPTION_KEY), with a last-4
// fingerprint kept for display. No Subsplash API calls happen yet — this is
// just secure capture so the Engagement API sync can be wired up later.

export interface StoredSubsplashCreds {
  hasCreds: boolean;
  apiKeyLast4: string | null;
  clientSecretLast4: string | null;
  appIdLast4: string | null;
  organizationName: string | null;
  /** Set once a real connection is verified — null until the API is wired. */
  verifiedAt: string | null;
  updatedAt: string | null;
}

export function getStoredSubsplashCreds(orgId: number): StoredSubsplashCreds {
  const row = getDb()
    .prepare(
      `SELECT api_key_last4, client_secret_last4, app_id_last4,
              organization_name, verified_at, updated_at
         FROM subsplash_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        api_key_last4: string | null;
        client_secret_last4: string | null;
        app_id_last4: string | null;
        organization_name: string | null;
        verified_at: string | null;
        updated_at: string | null;
      }
    | undefined;
  if (!row) {
    return {
      hasCreds: false,
      apiKeyLast4: null,
      clientSecretLast4: null,
      appIdLast4: null,
      organizationName: null,
      verifiedAt: null,
      updatedAt: null,
    };
  }
  return {
    hasCreds: !!row.api_key_last4,
    apiKeyLast4: row.api_key_last4,
    clientSecretLast4: row.client_secret_last4,
    appIdLast4: row.app_id_last4,
    organizationName: row.organization_name,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

/** Decrypted credentials — for the future sync layer. */
export function getDecryptedSubsplashCreds(orgId: number): {
  apiKey: string;
  clientSecret: string | null;
  appId: string | null;
} | null {
  const row = getDb()
    .prepare(
      `SELECT api_key_enc, client_secret_enc, app_id_enc
         FROM subsplash_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        api_key_enc: string | null;
        client_secret_enc: string | null;
        app_id_enc: string | null;
      }
    | undefined;
  if (!row || !row.api_key_enc) return null;
  return {
    apiKey: decrypt(row.api_key_enc),
    clientSecret: row.client_secret_enc ? decrypt(row.client_secret_enc) : null,
    appId: row.app_id_enc ? decrypt(row.app_id_enc) : null,
  };
}

export function saveSubsplashCreds(
  orgId: number,
  apiKey: string,
  clientSecret: string | null,
  appId: string | null,
) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO subsplash_credentials
         (org_id, api_key_enc, api_key_last4, client_secret_enc,
          client_secret_last4, app_id_enc, app_id_last4, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         api_key_enc = excluded.api_key_enc,
         api_key_last4 = excluded.api_key_last4,
         client_secret_enc = excluded.client_secret_enc,
         client_secret_last4 = excluded.client_secret_last4,
         app_id_enc = excluded.app_id_enc,
         app_id_last4 = excluded.app_id_last4,
         updated_at = excluded.updated_at`,
    )
    .run(
      orgId,
      encrypt(apiKey),
      last4(apiKey),
      clientSecret ? encrypt(clientSecret) : null,
      clientSecret ? last4(clientSecret) : null,
      appId ? encrypt(appId) : null,
      appId ? last4(appId) : null,
      now,
    );
}

export function deleteSubsplashCreds(orgId: number) {
  getDb().prepare("DELETE FROM subsplash_credentials WHERE org_id = ?").run(orgId);
}
