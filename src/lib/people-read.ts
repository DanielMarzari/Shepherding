import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

// Active and Shepherded are reserved for later when richer signals
// (form submissions, group/team membership, attendance) are wired up.
// For the rough-draft today, classification is purely from pco_updated_at:
//   recent (within threshold)  → present
//   stale  (older than threshold OR null) → inactive
// PCO's `status` column is intentionally ignored — it isn't maintained
// reliably enough to trust.
export type ActivityClassification = "active" | "present" | "inactive";

export interface SyncedPersonRow {
  pcoId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  initials: string;
  birthdate: string | null;
  address: string | null;
  gender: string | null;
  membershipType: string | null;
  maritalStatus: string | null;
  pcoCreatedAt: string | null;
  pcoUpdatedAt: string | null;
  classification: ActivityClassification;
}

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
  birthdate?: string | null;
  address?: string | null;
}

interface RawRow {
  pco_id: string;
  enc_pii: string | null;
  gender: string | null;
  membership_type: string | null;
  marital_status: string | null;
  pco_created_at: string | null;
  pco_updated_at: string | null;
}

function cutoffIso(activityMonths: number): string {
  return new Date(
    Date.now() - activityMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function classify(
  pcoUpdatedAt: string | null,
  activityMonths: number,
): ActivityClassification {
  if (pcoUpdatedAt && pcoUpdatedAt >= cutoffIso(activityMonths)) {
    return "present";
  }
  return "inactive";
}

function toRow(r: RawRow, activityMonths: number): SyncedPersonRow {
  const pii = decryptJson<PIIBlob>(r.enc_pii) ?? {};
  const firstName = pii.first_name ?? null;
  const lastName = pii.last_name ?? null;
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") || `(unknown #${r.pco_id})`;
  const initials =
    ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "??";
  return {
    pcoId: r.pco_id,
    firstName,
    lastName,
    fullName,
    initials,
    birthdate: pii.birthdate ?? null,
    address: pii.address ?? null,
    gender: r.gender,
    membershipType: r.membership_type,
    maritalStatus: r.marital_status,
    pcoCreatedAt: r.pco_created_at,
    pcoUpdatedAt: r.pco_updated_at,
    classification: classify(r.pco_updated_at, activityMonths),
  };
}

export interface ListPeopleOptions {
  orgId: number;
  activityMonths: number;
  tab: "all" | ActivityClassification;
  limit: number;
  offset: number;
}

export interface ListPeopleResult {
  rows: SyncedPersonRow[];
  total: number;
  pageSize: number;
  page: number;
}

/** Paginated, classification-filtered list of synced people. */
export function listPeople(opts: ListPeopleOptions): ListPeopleResult {
  const db = getDb();
  const cutoff = cutoffIso(opts.activityMonths);
  const { whereSql, whereArgs } = buildWhere(opts.orgId, opts.tab, cutoff);
  const rows = db
    .prepare(
      `SELECT pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at
         FROM pco_people
         ${whereSql}
         ORDER BY pco_updated_at DESC
         LIMIT ? OFFSET ?`,
    )
    .all(...whereArgs, opts.limit, opts.offset) as RawRow[];
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM pco_people ${whereSql}`)
    .get(...whereArgs) as { n: number };
  return {
    rows: rows.map((r) => toRow(r, opts.activityMonths)),
    total: totalRow.n,
    pageSize: opts.limit,
    page: Math.floor(opts.offset / opts.limit) + 1,
  };
}

function buildWhere(
  orgId: number,
  tab: "all" | ActivityClassification,
  cutoff: string,
): { whereSql: string; whereArgs: (string | number)[] } {
  if (tab === "active") {
    // No active candidates yet — richer signals come later.
    return {
      whereSql: "WHERE org_id = ? AND 1 = 0",
      whereArgs: [orgId],
    };
  }
  if (tab === "present") {
    return {
      whereSql: "WHERE org_id = ? AND pco_updated_at IS NOT NULL AND pco_updated_at >= ?",
      whereArgs: [orgId, cutoff],
    };
  }
  if (tab === "inactive") {
    return {
      whereSql: "WHERE org_id = ? AND (pco_updated_at IS NULL OR pco_updated_at < ?)",
      whereArgs: [orgId, cutoff],
    };
  }
  return {
    whereSql: "WHERE org_id = ?",
    whereArgs: [orgId],
  };
}

export interface ClassificationCounts {
  total: number;
  active: number;
  present: number;
  inactive: number;
  shepherded: number;
}

/** Cheap aggregate counts for the metric cards. Single round-trip. */
export function getClassificationCounts(
  orgId: number,
  activityMonths: number,
): ClassificationCounts {
  const db = getDb();
  const cutoff = cutoffIso(activityMonths);
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN pco_updated_at IS NOT NULL AND pco_updated_at >= ? THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN pco_updated_at IS NULL OR pco_updated_at < ? THEN 1 ELSE 0 END) AS inactive
       FROM pco_people
       WHERE org_id = ?`,
    )
    .get(cutoff, cutoff, orgId) as {
    total: number;
    present: number | null;
    inactive: number | null;
  };
  return {
    total: row.total,
    active: 0, // Reserved — needs richer signals.
    present: row.present ?? 0,
    inactive: row.inactive ?? 0,
    shepherded: 0, // Reserved — needs group/team membership.
  };
}
