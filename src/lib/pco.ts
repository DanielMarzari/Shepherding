import "server-only";
import { decrypt, encrypt, last4 } from "./encryption";
import { getDb } from "./db";

export interface PCOTestResult {
  ok: boolean;
  organizationName?: string;
  error?: string;
}

export interface StoredCreds {
  hasCreds: boolean;
  appIdLast4: string | null;
  secretLast4: string | null;
  webhookSecretLast4: string | null;
  organizationName: string | null;
  verifiedAt: string | null;
}

/** Calls PCO /people/v2 with HTTP Basic auth (App ID : Secret).
 *  PCO returns the organization details on the root endpoint. */
export async function testPcoConnection(
  appId: string,
  secret: string,
): Promise<PCOTestResult> {
  if (!appId || !secret) {
    return { ok: false, error: "App ID and Secret are required." };
  }
  const auth = Buffer.from(`${appId}:${secret}`).toString("base64");
  try {
    const res = await fetch("https://api.planningcenteronline.com/people/v2", {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "User-Agent": "Shepherding/0.1 (church management)",
      },
      cache: "no-store",
    });
    if (res.status === 401) {
      return { ok: false, error: "Invalid credentials. Check App ID and Secret." };
    }
    if (res.status === 403) {
      return { ok: false, error: "Token lacks permission. Grant 'people' scope in PCO." };
    }
    if (!res.ok) {
      return { ok: false, error: `PCO returned HTTP ${res.status}. Try again later.` };
    }
    const body = (await res.json()) as {
      data?: { attributes?: { name?: string } };
    };
    const name = body?.data?.attributes?.name ?? "Connected";
    return { ok: true, organizationName: name };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error.";
    return { ok: false, error: `Could not reach PCO: ${msg}` };
  }
}

export function getStoredCreds(orgId: number): StoredCreds {
  const row = getDb()
    .prepare(
      `SELECT app_id_last4, secret_last4, webhook_secret_last4, organization_name, verified_at
       FROM pco_credentials WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        app_id_last4: string | null;
        secret_last4: string | null;
        webhook_secret_last4: string | null;
        organization_name: string | null;
        verified_at: string | null;
      }
    | undefined;
  if (!row) {
    return {
      hasCreds: false,
      appIdLast4: null,
      secretLast4: null,
      webhookSecretLast4: null,
      organizationName: null,
      verifiedAt: null,
    };
  }
  return {
    hasCreds: !!(row.app_id_last4 && row.secret_last4),
    appIdLast4: row.app_id_last4,
    secretLast4: row.secret_last4,
    webhookSecretLast4: row.webhook_secret_last4,
    organizationName: row.organization_name,
    verifiedAt: row.verified_at,
  };
}

export function getDecryptedCreds(orgId: number): {
  appId: string;
  secret: string;
  webhookSecret: string | null;
} | null {
  const row = getDb()
    .prepare(
      "SELECT app_id_enc, secret_enc, webhook_secret_enc FROM pco_credentials WHERE org_id = ?",
    )
    .get(orgId) as
    | {
        app_id_enc: string | null;
        secret_enc: string | null;
        webhook_secret_enc: string | null;
      }
    | undefined;
  if (!row || !row.app_id_enc || !row.secret_enc) return null;
  return {
    appId: decrypt(row.app_id_enc),
    secret: decrypt(row.secret_enc),
    webhookSecret: row.webhook_secret_enc ? decrypt(row.webhook_secret_enc) : null,
  };
}

export function saveCreds(
  orgId: number,
  appId: string,
  secret: string,
  webhookSecret: string | null,
  organizationName: string,
) {
  const now = new Date().toISOString();
  const appIdEnc = encrypt(appId);
  const secretEnc = encrypt(secret);
  const webhookEnc = webhookSecret ? encrypt(webhookSecret) : null;
  getDb()
    .prepare(
      `INSERT INTO pco_credentials
         (org_id, app_id_enc, app_id_last4, secret_enc, secret_last4,
          webhook_secret_enc, webhook_secret_last4, organization_name, verified_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         app_id_enc = excluded.app_id_enc,
         app_id_last4 = excluded.app_id_last4,
         secret_enc = excluded.secret_enc,
         secret_last4 = excluded.secret_last4,
         webhook_secret_enc = excluded.webhook_secret_enc,
         webhook_secret_last4 = excluded.webhook_secret_last4,
         organization_name = excluded.organization_name,
         verified_at = excluded.verified_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      orgId,
      appIdEnc,
      last4(appId),
      secretEnc,
      last4(secret),
      webhookEnc,
      webhookSecret ? last4(webhookSecret) : null,
      organizationName,
      now,
      now,
    );
}

export function deleteCreds(orgId: number) {
  getDb().prepare("DELETE FROM pco_credentials WHERE org_id = ?").run(orgId);
}

// ─── Sync settings ─────────────────────────────────────────────────────────

export type SyncFrequency = "daily" | "weekly" | "monthly";

export interface SyncSettings {
  enabled: boolean;
  frequency: SyncFrequency;
  runAtHour: number;
  runAtDow: number;
  runAtDom: number;
  emailOnFailure: boolean;
  autoResolveConflicts: boolean;
  /** Months window for "active" classification (default 18). */
  activityMonths: number;
  /** Always look back this many months on each sync, even with a newer
   *  cursor — catches retroactive PCO edits (default 3). */
  syncThresholdMonths: number;
  /** Window for "recent activity" metrics — joins, leaves, attendance
   *  changes (default 3). Independent of activityMonths. */
  activityTrackingMonths: number;
  /** Average weekly Sunday attendance (manually entered). Null = not set. */
  weeklyAttendance: number | null;
  /** Weeks of consecutive non-attendance before a group member is treated
   *  as having left the group (default 10). */
  lapsedWeeks: number;
}

export function getSyncSettings(orgId: number): SyncSettings {
  const row = getDb()
    .prepare(
      `SELECT enabled, frequency, run_at_hour, run_at_dow, run_at_dom,
              email_on_failure, auto_resolve_conflicts,
              activity_months, sync_threshold_months,
              activity_tracking_months, weekly_attendance, lapsed_weeks
       FROM pco_sync_settings WHERE org_id = ?`,
    )
    .get(orgId) as
    | {
        enabled: number;
        frequency: string;
        run_at_hour: number;
        run_at_dow: number;
        run_at_dom: number;
        email_on_failure: number;
        auto_resolve_conflicts: number;
        activity_months: number;
        sync_threshold_months: number;
        activity_tracking_months: number | null;
        weekly_attendance: number | null;
        lapsed_weeks: number | null;
      }
    | undefined;
  if (!row) {
    return {
      enabled: false,
      frequency: "daily",
      runAtHour: 0,
      runAtDow: 0,
      runAtDom: 1,
      emailOnFailure: true,
      autoResolveConflicts: false,
      activityMonths: 18,
      syncThresholdMonths: 3,
      activityTrackingMonths: 3,
      weeklyAttendance: null,
      lapsedWeeks: 10,
    };
  }
  const freq: SyncFrequency =
    row.frequency === "weekly" || row.frequency === "monthly" ? row.frequency : "daily";
  return {
    enabled: !!row.enabled,
    frequency: freq,
    runAtHour: row.run_at_hour,
    runAtDow: row.run_at_dow,
    runAtDom: row.run_at_dom,
    emailOnFailure: !!row.email_on_failure,
    autoResolveConflicts: !!row.auto_resolve_conflicts,
    activityMonths: row.activity_months ?? 18,
    syncThresholdMonths: row.sync_threshold_months ?? 3,
    activityTrackingMonths: row.activity_tracking_months ?? 3,
    weeklyAttendance: row.weekly_attendance,
    lapsedWeeks: row.lapsed_weeks ?? 10,
  };
}

export function saveSyncSettings(orgId: number, s: SyncSettings) {
  getDb()
    .prepare(
      `INSERT INTO pco_sync_settings
         (org_id, enabled, frequency, run_at_hour, run_at_dow, run_at_dom,
          email_on_failure, auto_resolve_conflicts, activity_months,
          sync_threshold_months, activity_tracking_months, weekly_attendance,
          lapsed_weeks, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id) DO UPDATE SET
         enabled = excluded.enabled,
         frequency = excluded.frequency,
         run_at_hour = excluded.run_at_hour,
         run_at_dow = excluded.run_at_dow,
         run_at_dom = excluded.run_at_dom,
         email_on_failure = excluded.email_on_failure,
         auto_resolve_conflicts = excluded.auto_resolve_conflicts,
         activity_months = excluded.activity_months,
         sync_threshold_months = excluded.sync_threshold_months,
         activity_tracking_months = excluded.activity_tracking_months,
         weekly_attendance = excluded.weekly_attendance,
         lapsed_weeks = excluded.lapsed_weeks,
         updated_at = excluded.updated_at`,
    )
    .run(
      orgId,
      s.enabled ? 1 : 0,
      s.frequency,
      s.runAtHour,
      s.runAtDow,
      s.runAtDom,
      s.emailOnFailure ? 1 : 0,
      s.autoResolveConflicts ? 1 : 0,
      Math.max(1, Math.min(60, Math.floor(s.activityMonths))),
      Math.max(1, Math.min(60, Math.floor(s.syncThresholdMonths))),
      Math.max(1, Math.min(36, Math.floor(s.activityTrackingMonths))),
      s.weeklyAttendance == null
        ? null
        : Math.max(0, Math.min(1_000_000, Math.floor(s.weeklyAttendance))),
      Math.max(1, Math.min(52, Math.floor(s.lapsedWeeks))),
    );
}

/** Update only the metric-related thresholds (keeps the rest untouched). */
export function saveMetricsSettings(
  orgId: number,
  activityMonths: number,
  syncThresholdMonths: number,
  activityTrackingMonths: number,
  lapsedWeeks: number,
) {
  const current = getSyncSettings(orgId);
  saveSyncSettings(orgId, {
    ...current,
    activityMonths: Math.max(1, Math.min(60, Math.floor(activityMonths))),
    syncThresholdMonths: Math.max(1, Math.min(60, Math.floor(syncThresholdMonths))),
    activityTrackingMonths: Math.max(1, Math.min(36, Math.floor(activityTrackingMonths))),
    lapsedWeeks: Math.max(1, Math.min(52, Math.floor(lapsedWeeks))),
  });
}

export function saveWeeklyAttendance(orgId: number, weekly: number | null) {
  const current = getSyncSettings(orgId);
  saveSyncSettings(orgId, { ...current, weeklyAttendance: weekly });
}

// ─── Filters ──────────────────────────────────────────────────────────────

/** Membership types currently excluded from /people, /metrics counts, etc. */
export function getExcludedMembershipTypes(orgId: number): string[] {
  const row = getDb()
    .prepare(
      "SELECT excluded_membership_types FROM pco_sync_settings WHERE org_id = ?",
    )
    .get(orgId) as { excluded_membership_types: string | null } | undefined;
  if (!row?.excluded_membership_types) return [];
  try {
    const parsed = JSON.parse(row.excluded_membership_types);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function saveExcludedMembershipTypes(orgId: number, types: string[]) {
  const cleaned = Array.from(new Set(types.filter(Boolean)));
  const json = cleaned.length === 0 ? null : JSON.stringify(cleaned);
  // Ensure a row exists for this org first.
  const exists = getDb()
    .prepare("SELECT 1 FROM pco_sync_settings WHERE org_id = ?")
    .get(orgId);
  if (!exists) {
    // Create a default row, then set the column.
    saveSyncSettings(orgId, getSyncSettings(orgId));
  }
  getDb()
    .prepare(
      "UPDATE pco_sync_settings SET excluded_membership_types = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE org_id = ?",
    )
    .run(json, orgId);
}

/** Distinct membership types in the synced people, with counts. Used by
 *  the Filters page to let admins toggle exclusions. */
export function getMembershipTypeStats(
  orgId: number,
): { membershipType: string | null; count: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT membership_type AS membershipType, COUNT(*) AS count
         FROM pco_people
         WHERE org_id = ?
         GROUP BY membership_type
         ORDER BY COUNT(*) DESC, membership_type ASC`,
    )
    .all(orgId) as { membershipType: string | null; count: number }[];
  return rows;
}

// ─── Group-type filters ─────────────────────────────────────────────────

export function getExcludedGroupTypes(orgId: number): string[] {
  const row = getDb()
    .prepare(
      "SELECT excluded_group_types FROM pco_sync_settings WHERE org_id = ?",
    )
    .get(orgId) as { excluded_group_types: string | null } | undefined;
  if (!row?.excluded_group_types) return [];
  try {
    const parsed = JSON.parse(row.excluded_group_types);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function saveExcludedGroupTypes(orgId: number, ids: string[]) {
  const cleaned = Array.from(new Set(ids.filter(Boolean)));
  const json = cleaned.length === 0 ? null : JSON.stringify(cleaned);
  const exists = getDb()
    .prepare("SELECT 1 FROM pco_sync_settings WHERE org_id = ?")
    .get(orgId);
  if (!exists) {
    saveSyncSettings(orgId, getSyncSettings(orgId));
  }
  getDb()
    .prepare(
      "UPDATE pco_sync_settings SET excluded_group_types = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE org_id = ?",
    )
    .run(json, orgId);
}

/** Distinct group types in the synced groups, with member counts.
 *  Excluded types are still listed (so admins can re-include them). */
export function getGroupTypeStats(
  orgId: number,
): { groupTypeId: string | null; name: string | null; groups: number; members: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT
         g.group_type_id AS groupTypeId,
         t.name AS name,
         COUNT(DISTINCT g.pco_id) AS groups,
         COUNT(DISTINCT m.person_id) AS members
       FROM pco_groups g
       LEFT JOIN pco_group_types t
         ON t.org_id = g.org_id AND t.pco_id = g.group_type_id
       LEFT JOIN pco_group_memberships m
         ON m.org_id = g.org_id AND m.group_id = g.pco_id AND m.archived_at IS NULL
       WHERE g.org_id = ? AND g.archived_at IS NULL
       GROUP BY g.group_type_id, t.name
       ORDER BY COUNT(DISTINCT g.pco_id) DESC, t.name ASC`,
    )
    .all(orgId) as {
    groupTypeId: string | null;
    name: string | null;
    groups: number;
    members: number;
  }[];
  return rows;
}

// ─── What to sync (per-entity toggles) ────────────────────────────────────

export interface SyncEntity {
  key: string;
  label: string;
  description: string;
  required?: boolean;
  defaultEnabled?: boolean;
}

export const SYNC_ENTITIES: SyncEntity[] = [
  {
    key: "people",
    label: "People",
    description: "Names, contact info, demographics, household, status",
    required: true,
    defaultEnabled: true,
  },
  {
    key: "groups",
    label: "Groups & attendance",
    description:
      "Group definitions, memberships, applications, meeting events, and per-meeting attendance. Drives Shepherded classification, group health, and the Community lane.",
    defaultEnabled: true,
  },
  {
    key: "service_teams",
    label: "Service teams",
    description: "Worship, Hospitality, Greeters, Kids · membership + scheduling",
    defaultEnabled: true,
  },
  {
    key: "sunday_attendance",
    label: "Sunday attendance (Check-Ins)",
    description: "Required for Worship lane and falling-through-cracks rules",
    defaultEnabled: true,
  },
  {
    key: "giving",
    label: "Giving",
    description:
      "Donor records · drives the Giving lane. We never see amounts, only frequency.",
    defaultEnabled: false,
  },
  {
    key: "forms",
    label: "Forms",
    description: "Form submissions feed into activity tracking.",
    defaultEnabled: false,
  },
];

export function getSyncEntities(orgId: number): Record<string, boolean> {
  const rows = getDb()
    .prepare("SELECT entity, enabled FROM pco_sync_entities WHERE org_id = ?")
    .all(orgId) as { entity: string; enabled: number }[];
  const stored = new Map(rows.map((r) => [r.entity, !!r.enabled]));
  const out: Record<string, boolean> = {};
  for (const e of SYNC_ENTITIES) {
    out[e.key] = stored.has(e.key) ? stored.get(e.key)! : !!e.defaultEnabled;
  }
  return out;
}

export function saveSyncEntities(orgId: number, toggles: Record<string, boolean>) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO pco_sync_entities (org_id, entity, enabled) VALUES (?, ?, ?)
     ON CONFLICT(org_id, entity) DO UPDATE SET enabled = excluded.enabled`,
  );
  const tx = db.transaction((entries: [string, boolean][]) => {
    for (const [key, val] of entries) stmt.run(orgId, key, val ? 1 : 0);
  });
  // Always force required entities on
  const entries = SYNC_ENTITIES.map(
    (e) => [e.key, e.required ? true : !!toggles[e.key]] as [string, boolean],
  );
  tx(entries);
}

// Manual sync now runs the real PCO pull — see lib/pco-sync.ts.

export interface SyncRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  status: string;
  changes: number;
  warning: string | null;
}

export function listRecentSyncs(orgId: number, limit = 8): SyncRun[] {
  return (
    getDb()
      .prepare(
        `SELECT id, started_at, finished_at, trigger, status, changes, warning
       FROM pco_sync_runs WHERE org_id = ? ORDER BY started_at DESC LIMIT ?`,
      )
      .all(orgId, limit) as {
      id: number;
      started_at: string;
      finished_at: string | null;
      trigger: string;
      status: string;
      changes: number;
      warning: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    trigger: r.trigger,
    status: r.status,
    changes: r.changes,
    warning: r.warning,
  }));
}
