import "server-only";
import { getDb } from "./db";
import { decrypt, encrypt, last4 } from "./encryption";

/** Connections with no sync yet, and the credentials each one would need.
 *
 *  This is deliberately a list of WHAT IS MISSING, not a settings screen for
 *  things that work. Credentials come in two tiers (see migration 0092): a
 *  provider gets its own page and typed table once its sync works, as PCO,
 *  Constant Contact and Spotify have. Until then its credentials are stored
 *  here, in integration_credentials, one row per field. PushPay has no entry:
 *  its CSV exports already bring in the giving data and no published Output
 *  waits on its API, so a form here would collect secrets nothing reads.
 *  Whoever builds a PushPay API sync adds it then. Each entry records which
 *  published Ministry Impact Report Outputs it would unblock, so the cost of
 *  not having it is visible. */

export interface IntegrationField {
  key: string;
  label: string;
  help: string;
  /** Renders a textarea — for a .p8 key or a service-account JSON blob. */
  multiline?: boolean;
  optional?: boolean;
}

export interface IntegrationDef {
  provider: string;
  name: string;
  /** One line: what connecting it would give us. */
  what: string;
  /** Where the credential comes from, in enough detail to actually go and get it. */
  where: string[];
  /** Why it is not connected. Null once nothing is blocking it but the work. */
  blocker: string | null;
  /** The published Outputs this would move from unmeasured to measured. */
  outputs: string[];
  fields: IntegrationField[];
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    provider: "app_store_connect",
    name: "App Store Connect",
    what: "iOS downloads of the Faith Church app, by day and country.",
    where: [
      "The listing is published as “Faith Evangelical Free Church of Allentown” (bundle io.echurch.faithefc), so the developer account belongs to the church rather than to Subsplash — the key is ours to create.",
      "appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API. Creating a key needs the Account Holder or Admin role, and the key itself needs the Sales and Reports role, because downloads come from Sales and Trends rather than the general API.",
      "The .p8 private key downloads exactly once and Apple will not re-issue it. Save it before closing the tab.",
      "An API key only ever sees apps this team owns. There is no way to read another organisation's downloads.",
    ],
    blocker:
      "Waiting on whoever holds the Account Holder Apple ID. The seller name is the church, but the login may have been set up and kept by Subsplash.",
    outputs: ["191 app downloads/mo (Communications – Engagement)"],
    fields: [
      { key: "issuer_id", label: "Issuer ID", help: "A UUID, shown above the key list on the Integrations tab." },
      { key: "key_id", label: "Key ID", help: "Ten characters, shown next to the key you create." },
      { key: "private_key", label: "Private key (.p8)", help: "Paste the whole file, including the BEGIN and END lines.", multiline: true },
      { key: "vendor_number", label: "Vendor number", help: "From Payments and Financial Reports. Needed for Sales and Trends.", optional: true },
    ],
  },
  {
    provider: "google_play",
    name: "Google Play Console",
    what: "Android downloads of the Faith Church app.",
    where: [
      "Google Cloud console → create a service account → create a JSON key.",
      "Then Play Console → Users and permissions → invite that service account's email and grant it report access.",
      "Scoped to this developer account only, exactly like Apple's.",
    ],
    blocker: "Separate from Apple — needs whoever administers the church's Play Console.",
    outputs: ["191 app downloads/mo (Communications – Engagement), the Android half"],
    fields: [
      { key: "service_account_json", label: "Service account JSON", help: "The whole downloaded JSON file.", multiline: true },
      { key: "package_name", label: "Package name", help: "The Android application id, e.g. io.echurch.faithefc." },
    ],
  },
  {
    provider: "youtube",
    name: "YouTube",
    what: "Subscriber and view counts for the church channel.",
    where: [
      "A plain API key from the Google Cloud console with the YouTube Data API v3 enabled reads PUBLIC stats on any channel — current subscribers and total views. No OAuth, no channel ownership.",
      "That only ever gives TODAY's number, and YouTube rounds public subscriber counts. We would snapshot it monthly from the day it is connected, so “new subscribers per month” starts building then and has no history.",
      "Real history needs the YouTube ANALYTICS API with OAuth as the channel owner. A personal Google account works only if it actually owns or manages the Faith Church channel.",
    ],
    blocker: "None for the public-stats version — an API key is free and enough to start the monthly snapshot.",
    outputs: ["20 new subscribers to YouTube/mo (Communications – Engagement)"],
    fields: [
      { key: "api_key", label: "API key", help: "Google Cloud → APIs and Services → Credentials, with YouTube Data API v3 enabled." },
      { key: "channel_id", label: "Channel ID", help: "Starts with UC. Found in YouTube Studio → Settings → Channel → Advanced." },
    ],
  },
  {
    provider: "instagram",
    name: "Instagram",
    what: "Posts, views, reach, likes, comments and shares for the Faith Church page.",
    where: [
      "Needs the account to be a Business or Creator account linked to a Facebook Page, then a Meta app with instagram_basic and instagram_manage_insights, then a long-lived access token.",
      "The token is issued against the account that grants it, so this cannot be done from a personal account that does not administer the church page.",
    ],
    blocker:
      "Access to the church's Instagram account is not available. This is the largest single gap across both Communications reports — one connection would fill five published Outputs.",
    outputs: [
      "61,500 social media views/mo",
      "2,420 interactions with social media/mo",
      "21 avg social media shares per post",
      "11 social media DMs/mo",
      "18 social media posts/mo (Communications – Content Creation)",
    ],
    fields: [
      { key: "access_token", label: "Long-lived access token", help: "From the Meta app, exchanged for a 60-day token.", multiline: true },
      { key: "ig_user_id", label: "Instagram user ID", help: "The numeric id of the connected professional account." },
    ],
  },
  {
    // Had its own page and table (0059) until 0092, storing credentials that
    // nothing read. There is still no sync and no Subsplash data here at all.
    provider: "subsplash",
    name: "Subsplash",
    what: "In-app sermon views from the Faith Church app and, if Subsplash's API reports them per person, app activity as engagement signals.",
    where: [
      "Ask Subsplash what API access the church's account includes before anyone builds against it.",
      "The questions that decide whether this is worth doing: does it report in-app sermon views, and per person or only as totals?",
      "Whatever they issue goes below: an API key or access token, plus a client secret and app ID only if their access uses them.",
    ],
    blocker:
      "Nobody has confirmed that the church's Subsplash account includes API access, or what it would report.",
    outputs: ["555 sermon views-app/mo (Communications – Engagement)"],
    fields: [
      { key: "api_key", label: "API key or access token", help: "Issued by Subsplash for the church's account." },
      { key: "client_secret", label: "Client secret", help: "Only if their access uses one.", optional: true },
      { key: "app_id", label: "App ID", help: "The Subsplash identifier for the Faith Church app, if they ask for it.", optional: true },
    ],
  },
];

export interface StoredField {
  field: string;
  last4: string | null;
  updatedAt: string;
}

/** What is stored for one provider — last-4 fingerprints only, never values. */
export function getIntegrationStatus(orgId: number, provider: string): StoredField[] {
  return getDb()
    .prepare(
      `SELECT field, value_last4 AS last4, updated_at AS updatedAt
         FROM integration_credentials
        WHERE org_id = ? AND provider = ? ORDER BY field`,
    )
    .all(orgId, provider) as StoredField[];
}

export function getAllIntegrationStatus(orgId: number): Record<string, StoredField[]> {
  const out: Record<string, StoredField[]> = {};
  for (const def of INTEGRATIONS) out[def.provider] = getIntegrationStatus(orgId, def.provider);
  return out;
}

/** Store one provider's fields. A blank value leaves whatever is already
 *  stored alone, so re-saving a form to change ONE secret does not wipe the
 *  others — the form never renders existing values back to the browser. */
export function saveIntegrationCredentials(
  orgId: number,
  provider: string,
  values: Record<string, string>,
) {
  const def = INTEGRATIONS.find((d) => d.provider === provider);
  if (!def) throw new Error(`Unknown integration: ${provider}`);
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO integration_credentials (org_id, provider, field, value_enc, value_last4, updated_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, provider, field) DO UPDATE SET
       value_enc = excluded.value_enc,
       value_last4 = excluded.value_last4,
       updated_at = excluded.updated_at`,
  );
  const tx = db.transaction(() => {
    for (const f of def.fields) {
      const raw = (values[f.key] ?? "").trim();
      if (!raw) continue;
      stmt.run(orgId, provider, f.key, encrypt(raw), last4(raw));
    }
  });
  tx();
}

export function deleteIntegrationCredentials(orgId: number, provider: string) {
  getDb()
    .prepare(`DELETE FROM integration_credentials WHERE org_id = ? AND provider = ?`)
    .run(orgId, provider);
}

/** Decrypted values — for whoever builds the sync. Never reaches the browser. */
export function getIntegrationSecrets(
  orgId: number,
  provider: string,
): Record<string, string> {
  const rows = getDb()
    .prepare(
      `SELECT field, value_enc FROM integration_credentials WHERE org_id = ? AND provider = ?`,
    )
    .all(orgId, provider) as Array<{ field: string; value_enc: string }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.field] = decrypt(r.value_enc);
  return out;
}
