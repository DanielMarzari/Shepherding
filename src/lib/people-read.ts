import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { getExcludedMembershipTypes } from "./pco";

export type ActivityClassification = "active" | "present" | "inactive";

export type SortColumn = "updated" | "created" | "membership" | "status";
export type SortDir = "asc" | "desc";

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
  sort: SortColumn;
  dir: SortDir;
}

export interface ListPeopleResult {
  rows: SyncedPersonRow[];
  total: number;
  pageSize: number;
  page: number;
}

export function listPeople(opts: ListPeopleOptions): ListPeopleResult {
  const db = getDb();
  const cutoff = cutoffIso(opts.activityMonths);
  const excluded = getExcludedMembershipTypes(opts.orgId);
  const { whereSql, whereArgs } = buildWhere(opts.orgId, opts.tab, cutoff, excluded);
  const orderSql = buildOrderBy(opts.sort, opts.dir, cutoff);

  const rows = db
    .prepare(
      `SELECT pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at
         FROM pco_people
         ${whereSql}
         ${orderSql}
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
  excludedTypes: string[],
): { whereSql: string; whereArgs: (string | number)[] } {
  const parts: string[] = ["org_id = ?"];
  const args: (string | number)[] = [orgId];

  if (tab === "active") {
    parts.push("1 = 0"); // reserved — none qualify yet
  } else if (tab === "present") {
    parts.push("pco_updated_at IS NOT NULL AND pco_updated_at >= ?");
    args.push(cutoff);
  } else if (tab === "inactive") {
    parts.push("(pco_updated_at IS NULL OR pco_updated_at < ?)");
    args.push(cutoff);
  }

  if (excludedTypes.length > 0) {
    const placeholders = excludedTypes.map(() => "?").join(",");
    // membership_type can be NULL, which we treat as "no type" and never exclude.
    parts.push(`(membership_type IS NULL OR membership_type NOT IN (${placeholders}))`);
    args.push(...excludedTypes);
  }

  return { whereSql: `WHERE ${parts.join(" AND ")}`, whereArgs: args };
}

function buildOrderBy(sort: SortColumn, dir: SortDir, cutoff: string): string {
  const direction = dir === "asc" ? "ASC" : "DESC";
  // SQLite uses NULLS LAST when sorting DESC by default for column with
  // null values? Actually no — explicit NULLS LAST keeps null rows at
  // the bottom regardless of direction.
  const nulls = "NULLS LAST";
  switch (sort) {
    case "updated":
      return `ORDER BY pco_updated_at ${direction} ${nulls}`;
    case "created":
      return `ORDER BY pco_created_at ${direction} ${nulls}`;
    case "membership":
      return `ORDER BY membership_type ${direction} ${nulls}, pco_updated_at DESC`;
    case "status": {
      // Present (updated within threshold) vs Inactive — sort by the boolean.
      const presentExpr = `(pco_updated_at IS NOT NULL AND pco_updated_at >= '${cutoff}')`;
      // direction asc = inactive first, desc = present first
      return `ORDER BY ${presentExpr} ${direction}, pco_updated_at DESC`;
    }
    default:
      return `ORDER BY pco_updated_at DESC ${nulls}`;
  }
}

export interface ClassificationCounts {
  total: number;
  active: number;
  present: number;
  inactive: number;
  shepherded: number;
}

export function getClassificationCounts(
  orgId: number,
  activityMonths: number,
): ClassificationCounts {
  const db = getDb();
  const cutoff = cutoffIso(activityMonths);
  const excluded = getExcludedMembershipTypes(orgId);
  const exclSql =
    excluded.length === 0
      ? ""
      : ` AND (membership_type IS NULL OR membership_type NOT IN (${excluded.map(() => "?").join(",")}))`;
  const args = [cutoff, cutoff, orgId, ...excluded];
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN pco_updated_at IS NOT NULL AND pco_updated_at >= ? THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN pco_updated_at IS NULL OR pco_updated_at < ? THEN 1 ELSE 0 END) AS inactive
       FROM pco_people
       WHERE org_id = ?${exclSql}`,
    )
    .get(...args) as {
    total: number;
    present: number | null;
    inactive: number | null;
  };
  return {
    total: row.total,
    active: 0,
    present: row.present ?? 0,
    inactive: row.inactive ?? 0,
    shepherded: 0,
  };
}
