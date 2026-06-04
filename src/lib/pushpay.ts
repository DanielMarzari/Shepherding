import "server-only";
import { getDb } from "./db";
import { decrypt, encrypt, last4 } from "./encryption";

// PushPay credential storage. Mirrors the PCO credential pattern: secrets
// are AES-256-GCM encrypted at rest (same ENCRYPTION_KEY), with a last-4
// fingerprint kept for display. No PushPay API calls happen yet — this is
// just secure capture so the sync can be wired up later.

export interface StoredPushpayCreds {
  hasCreds: boolean;
  clientIdLast4: string | null;
  clientSecretLast4: string | null;
  orgKeyLast4: string | null;
  organizationName: string | null;
  /** Set once a real connection is verified — null until the API is wired. */
  verifiedAt: string | null;
  updatedAt: string | null;
}

export function getStoredPushpayCreds(orgId: number): StoredPushpayCreds {
  const row = getDb()
    .prepare(
      `SELECT client_id_last4, client_secret_last4, org_key_last4,
              organization_name, verified_at, updated_at
         FROM pushpay_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        client_id_last4: string | null;
        client_secret_last4: string | null;
        org_key_last4: string | null;
        organization_name: string | null;
        verified_at: string | null;
        updated_at: string | null;
      }
    | undefined;
  if (!row) {
    return {
      hasCreds: false,
      clientIdLast4: null,
      clientSecretLast4: null,
      orgKeyLast4: null,
      organizationName: null,
      verifiedAt: null,
      updatedAt: null,
    };
  }
  return {
    hasCreds: !!(row.client_id_last4 && row.client_secret_last4),
    clientIdLast4: row.client_id_last4,
    clientSecretLast4: row.client_secret_last4,
    orgKeyLast4: row.org_key_last4,
    organizationName: row.organization_name,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
  };
}

/** Decrypted credentials — for the future sync layer. */
export function getDecryptedPushpayCreds(orgId: number): {
  clientId: string;
  clientSecret: string;
  orgKey: string | null;
} | null {
  const row = getDb()
    .prepare(
      `SELECT client_id_enc, client_secret_enc, org_key_enc
         FROM pushpay_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        client_id_enc: string | null;
        client_secret_enc: string | null;
        org_key_enc: string | null;
      }
    | undefined;
  if (!row || !row.client_id_enc || !row.client_secret_enc) return null;
  return {
    clientId: decrypt(row.client_id_enc),
    clientSecret: decrypt(row.client_secret_enc),
    orgKey: row.org_key_enc ? decrypt(row.org_key_enc) : null,
  };
}

export function savePushpayCreds(
  orgId: number,
  clientId: string,
  clientSecret: string,
  orgKey: string | null,
) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO pushpay_credentials
         (org_id, client_id_enc, client_id_last4, client_secret_enc,
          client_secret_last4, org_key_enc, org_key_last4, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         client_id_enc = excluded.client_id_enc,
         client_id_last4 = excluded.client_id_last4,
         client_secret_enc = excluded.client_secret_enc,
         client_secret_last4 = excluded.client_secret_last4,
         org_key_enc = excluded.org_key_enc,
         org_key_last4 = excluded.org_key_last4,
         updated_at = excluded.updated_at`,
    )
    .run(
      orgId,
      encrypt(clientId),
      last4(clientId),
      encrypt(clientSecret),
      last4(clientSecret),
      orgKey ? encrypt(orgKey) : null,
      orgKey ? last4(orgKey) : null,
      now,
    );
}

export function deletePushpayCreds(orgId: number) {
  getDb().prepare("DELETE FROM pushpay_credentials WHERE org_id = ?").run(orgId);
}
