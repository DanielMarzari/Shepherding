import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { getExcludedGroupTypes, getExcludedMembershipTypes } from "./pco";

// Classification (priority: shepherded > active > present > inactive):
//   shepherded = in a group OR a team  (no group/team data synced yet — 0)
//   active     = NOT shepherded, has form submission / event registration
//                / similar within threshold
//   present    = NOT shepherded/active, has pco_updated_at within threshold
//   inactive   = no measurable activity within threshold
export type ActivityClassification = "shepherded" | "active" | "present" | "inactive";

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
  lastFormSubmissionAt: string | null;
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
  last_form_submission_at: string | null;
  is_shepherded: number;
}

function cutoffIso(activityMonths: number): string {
  return new Date(
    Date.now() - activityMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function classify(
  pcoUpdatedAt: string | null,
  lastFormSubmissionAt: string | null,
  isShepherded: boolean,
  activityMonths: number,
): ActivityClassification {
  if (isShepherded) return "shepherded";
  const cutoff = cutoffIso(activityMonths);
  if (lastFormSubmissionAt && lastFormSubmissionAt >= cutoff) return "active";
  if (pcoUpdatedAt && pcoUpdatedAt >= cutoff) return "present";
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
    lastFormSubmissionAt: r.last_form_submission_at,
    classification: classify(
      r.pco_updated_at,
      r.last_form_submission_at,
      r.is_shepherded === 1,
      activityMonths,
    ),
  };
}

/** A subquery that's TRUE when the person is in at least one active
 *  group whose group_type isn't on the org's exclusion list. Build
 *  fresh per call so the exclusion list is honored at read time. */
function shepherdedSubq(excludedGroupTypeIds: string[]): {
  sql: string;
  args: string[];
} {
  if (excludedGroupTypeIds.length === 0) {
    return {
      sql: `(
        SELECT 1 FROM pco_group_memberships m
         WHERE m.org_id = pco_people.org_id
           AND m.person_id = pco_people.pco_id
           AND m.archived_at IS NULL
         LIMIT 1
      )`,
      args: [],
    };
  }
  const placeholders = excludedGroupTypeIds.map(() => "?").join(",");
  return {
    sql: `(
      SELECT 1
        FROM pco_group_memberships m
        JOIN pco_groups g
          ON g.org_id = m.org_id AND g.pco_id = m.group_id
       WHERE m.org_id = pco_people.org_id
         AND m.person_id = pco_people.pco_id
         AND m.archived_at IS NULL
         AND (g.group_type_id IS NULL OR g.group_type_id NOT IN (${placeholders}))
       LIMIT 1
    )`,
    args: excludedGroupTypeIds,
  };
}

export interface ListPeopleOptions {
  orgId: number;
  activityMonths: number;
  /** "all" hides inactive by default; pass "all-incl-inactive" to override. */
  tab: "all" | ActivityClassification | "all-incl-inactive";
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
  const excludedGroupTypes = getExcludedGroupTypes(opts.orgId);
  const shep = shepherdedSubq(excludedGroupTypes);
  const { whereSql, whereArgs } = buildWhere(
    opts.orgId,
    opts.tab,
    cutoff,
    excluded,
    shep,
  );
  const orderSql = buildOrderBy(opts.sort, opts.dir, cutoff);

  const rows = db
    .prepare(
      `SELECT pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at,
              CASE WHEN EXISTS ${shep.sql} THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         ${whereSql}
         ${orderSql}
         LIMIT ? OFFSET ?`,
    )
    .all(...shep.args, ...whereArgs, opts.limit, opts.offset) as RawRow[];
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
  tab: ListPeopleOptions["tab"],
  cutoff: string,
  excludedTypes: string[],
  shep: { sql: string; args: string[] },
): { whereSql: string; whereArgs: (string | number)[] } {
  const parts: string[] = ["org_id = ?"];
  const args: (string | number)[] = [orgId];

  if (tab === "shepherded") {
    parts.push(`EXISTS ${shep.sql}`);
    args.push(...shep.args);
  } else if (tab === "active") {
    parts.push(`NOT EXISTS ${shep.sql}`);
    args.push(...shep.args);
    parts.push("last_form_submission_at IS NOT NULL AND last_form_submission_at >= ?");
    args.push(cutoff);
  } else if (tab === "present") {
    parts.push(`NOT EXISTS ${shep.sql}`);
    args.push(...shep.args);
    parts.push(
      "(last_form_submission_at IS NULL OR last_form_submission_at < ?)",
      "pco_updated_at IS NOT NULL AND pco_updated_at >= ?",
    );
    args.push(cutoff, cutoff);
  } else if (tab === "inactive") {
    parts.push(`NOT EXISTS ${shep.sql}`);
    args.push(...shep.args);
    parts.push(
      "(last_form_submission_at IS NULL OR last_form_submission_at < ?)",
      "(pco_updated_at IS NULL OR pco_updated_at < ?)",
    );
    args.push(cutoff, cutoff);
  } else if (tab === "all") {
    parts.push(
      `(EXISTS ${shep.sql}
         OR (last_form_submission_at IS NOT NULL AND last_form_submission_at >= ?)
         OR (pco_updated_at IS NOT NULL AND pco_updated_at >= ?))`,
    );
    args.push(...shep.args, cutoff, cutoff);
  }

  if (excludedTypes.length > 0) {
    const placeholders = excludedTypes.map(() => "?").join(",");
    parts.push(`(membership_type IS NULL OR membership_type NOT IN (${placeholders}))`);
    args.push(...excludedTypes);
  }

  return { whereSql: `WHERE ${parts.join(" AND ")}`, whereArgs: args };
}

function buildOrderBy(sort: SortColumn, dir: SortDir, cutoff: string): string {
  const direction = dir === "asc" ? "ASC" : "DESC";
  const nulls = "NULLS LAST";
  switch (sort) {
    case "updated":
      return `ORDER BY pco_updated_at ${direction} ${nulls}`;
    case "created":
      return `ORDER BY pco_created_at ${direction} ${nulls}`;
    case "membership":
      return `ORDER BY membership_type ${direction} ${nulls}, pco_updated_at DESC`;
    case "status": {
      // Active=2, Present=1, Inactive=0 (so DESC = active first, ASC = inactive first)
      const expr = `(
        CASE
          WHEN last_form_submission_at IS NOT NULL AND last_form_submission_at >= '${cutoff}' THEN 2
          WHEN pco_updated_at IS NOT NULL AND pco_updated_at >= '${cutoff}' THEN 1
          ELSE 0
        END
      )`;
      return `ORDER BY ${expr} ${direction}, pco_updated_at DESC`;
    }
    default:
      return `ORDER BY pco_updated_at DESC ${nulls}`;
  }
}

export interface ClassificationCounts {
  total: number;
  shepherded: number;
  active: number;
  present: number;
  inactive: number;
  /** Total minus inactive — what "All" shows by default. */
  visibleByDefault: number;
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
  const args = [cutoff, cutoff, cutoff, cutoff, orgId, ...excluded];
  // Use a CTE so the shepherded subquery (and its bound parameters) only
  // appears once in the SQL. Avoids the previous off-by-one parameter
  // bookkeeping that crashed once any group types were excluded.
  const shep = shepherdedSubq(getExcludedGroupTypes(orgId));
  const row = db
    .prepare(
      `WITH classified AS (
         SELECT
           pco_id,
           membership_type,
           last_form_submission_at,
           pco_updated_at,
           CASE WHEN EXISTS ${shep.sql} THEN 1 ELSE 0 END AS shep
         FROM pco_people
         WHERE org_id = ?${exclSql}
       )
       SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN shep = 1 THEN 1 ELSE 0 END) AS shepherded,
         SUM(CASE
               WHEN shep = 0
                AND last_form_submission_at IS NOT NULL
                AND last_form_submission_at >= ?
               THEN 1 ELSE 0 END) AS active,
         SUM(CASE
               WHEN shep = 0
                AND (last_form_submission_at IS NULL OR last_form_submission_at < ?)
                AND pco_updated_at IS NOT NULL
                AND pco_updated_at >= ?
               THEN 1 ELSE 0 END) AS present,
         SUM(CASE
               WHEN shep = 0
                AND (last_form_submission_at IS NULL OR last_form_submission_at < ?)
                AND (pco_updated_at IS NULL OR pco_updated_at < ?)
               THEN 1 ELSE 0 END) AS inactive
       FROM classified`,
    )
    .get(
      ...shep.args, // for the EXISTS subquery in the CTE
      orgId,
      ...excluded,
      cutoff, // active
      cutoff, // present (last_form < cutoff)
      cutoff, // present (pco_updated >= cutoff)
      cutoff, // inactive (last_form < cutoff)
      cutoff, // inactive (pco_updated < cutoff)
    ) as {
    total: number;
    shepherded: number | null;
    active: number | null;
    present: number | null;
    inactive: number | null;
  };
  void args;
  const shepherded = row.shepherded ?? 0;
  const active = row.active ?? 0;
  const present = row.present ?? 0;
  const inactive = row.inactive ?? 0;
  return {
    total: row.total,
    shepherded,
    active,
    present,
    inactive,
    visibleByDefault: row.total - inactive,
  };
}

// ─── Single-person fetch (for the profile page) ────────────────────────

export function getPersonByPcoId(
  orgId: number,
  pcoId: string,
  activityMonths: number,
): SyncedPersonRow | null {
  const shep = shepherdedSubq(getExcludedGroupTypes(orgId));
  const row = getDb()
    .prepare(
      `SELECT pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at,
              CASE WHEN EXISTS ${shep.sql} THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         WHERE org_id = ? AND pco_id = ?`,
    )
    .get(...shep.args, orgId, pcoId) as RawRow | undefined;
  if (!row) return null;
  return toRow(row, activityMonths);
}

export interface PersonFormSubmission {
  formId: string;
  formName: string | null;
  pcoId: string;
  createdAt: string | null;
  verified: boolean;
}

export function listPersonFormSubmissions(
  orgId: number,
  pcoId: string,
): PersonFormSubmission[] {
  const rows = getDb()
    .prepare(
      `SELECT s.form_id, s.pco_id, s.pco_created_at, s.verified, f.name AS form_name
         FROM pco_form_submissions s
         LEFT JOIN pco_forms f ON f.org_id = s.org_id AND f.pco_id = s.form_id
         WHERE s.org_id = ? AND s.person_id = ?
         ORDER BY s.pco_created_at DESC`,
    )
    .all(orgId, pcoId) as {
    form_id: string;
    pco_id: string;
    pco_created_at: string | null;
    verified: number;
    form_name: string | null;
  }[];
  return rows.map((r) => ({
    formId: r.form_id,
    formName: r.form_name,
    pcoId: r.pco_id,
    createdAt: r.pco_created_at,
    verified: !!r.verified,
  }));
}

// ─── Search ────────────────────────────────────────────────────────────

export interface SearchHit {
  pcoId: string;
  fullName: string;
  initials: string;
  classification: ActivityClassification;
  membershipType: string | null;
}

/** Decrypt-and-match across all synced people for the org. With ~33k
 *  rows this takes ~50-150ms server-side; called from a server action
 *  on each keystroke (the client debounces). */
export function searchPeople(
  orgId: number,
  query: string,
  activityMonths: number,
  limit = 8,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const shep = shepherdedSubq(getExcludedGroupTypes(orgId));
  const rows = getDb()
    .prepare(
      `SELECT pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at,
              CASE WHEN EXISTS ${shep.sql} THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         WHERE org_id = ?`,
    )
    .all(...shep.args, orgId) as RawRow[];
  const hits: SearchHit[] = [];
  for (const r of rows) {
    const person = toRow(r, activityMonths);
    const haystack = `${person.firstName ?? ""} ${person.lastName ?? ""}`.toLowerCase();
    if (haystack.includes(q)) {
      hits.push({
        pcoId: person.pcoId,
        fullName: person.fullName,
        initials: person.initials,
        classification: person.classification,
        membershipType: person.membershipType,
      });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
