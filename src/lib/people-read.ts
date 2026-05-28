import "server-only";
import { cache } from "react";
import { getOrgSnapshot } from "./dashboard-refresh";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import {
  getExcludedCheckinEvents,
  getExcludedGroupTypes,
  getExcludedMembershipTypes,
  getExcludedTeamPositions,
  getExcludedTeamTypes,
  getSyncSettings,
} from "./pco";

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
  isMinor: boolean;
  birthYear: number | null;
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
  last_check_in_at: string | null;
  is_shepherded: number;
  is_minor: number;
  birth_year: number | null;
}

function cutoffIso(activityMonths: number): string {
  return new Date(
    Date.now() - activityMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function classify(
  pcoUpdatedAt: string | null,
  lastFormSubmissionAt: string | null,
  lastCheckInAt: string | null,
  isShepherded: boolean,
  activityMonths: number,
): ActivityClassification {
  if (isShepherded) return "shepherded";
  const cutoff = cutoffIso(activityMonths);
  if (lastFormSubmissionAt && lastFormSubmissionAt >= cutoff) return "active";
  if (lastCheckInAt && lastCheckInAt >= cutoff) return "active";
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
      r.last_check_in_at,
      r.is_shepherded === 1,
      activityMonths,
    ),
    isMinor: r.is_minor === 1,
    birthYear: r.birth_year,
  };
}

/**
 * Populate a connection-local TEMP TABLE with the set of person_ids who
 * are shepherded — in at least one active group whose group_type isn't
 * excluded. The TEMP TABLE has a PRIMARY KEY on person_id so any
 * subsequent `LEFT JOIN temp.shep_set s ON s.person_id = ...` uses
 * an indexed lookup (O(log N)) instead of the FULL SCAN that materialized
 * CTEs do.
 *
 * better-sqlite3 is synchronous on a single connection, so requests can't
 * race to clobber this table.
 */
export function populateShepherdedTempTable(orgId: number) {
  const db = getDb();
  const excludedGroups = getExcludedGroupTypes(orgId);
  const excludedTeams = getExcludedTeamTypes(orgId);
  const excludedPositions = getExcludedTeamPositions(orgId);
  const excludedCheckinEvents = getExcludedCheckinEvents(orgId);
  db.exec(
    "CREATE TEMP TABLE IF NOT EXISTS shep_set (person_id TEXT PRIMARY KEY)",
  );
  db.exec("DELETE FROM temp.shep_set");

  // Source 1: anyone in an active group whose group_type isn't excluded.
  if (excludedGroups.length === 0) {
    db.prepare(
      `INSERT OR IGNORE INTO temp.shep_set (person_id)
        SELECT DISTINCT person_id
          FROM pco_group_memberships
         WHERE org_id = ?
           AND archived_at IS NULL`,
    ).run(orgId);
  } else {
    const placeholders = excludedGroups.map(() => "?").join(",");
    db.prepare(
      `INSERT OR IGNORE INTO temp.shep_set (person_id)
        SELECT DISTINCT m.person_id
          FROM pco_group_memberships m
          JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
         WHERE m.org_id = ?
           AND m.archived_at IS NULL
           AND (g.group_type_id IS NULL OR g.group_type_id NOT IN (${placeholders}))`,
    ).run(orgId, ...excludedGroups);
  }

  // Source 2: anyone on the active roster of a non-archived team whose
  // service_type isn't excluded AND whose position isn't excluded.
  // Archived teams don't count.
  const teamWhere =
    excludedTeams.length === 0
      ? ""
      : `AND (t.service_type_id IS NULL OR t.service_type_id NOT IN (${excludedTeams
          .map(() => "?")
          .join(",")}))`;
  const posWhere =
    excludedPositions.length === 0
      ? ""
      : `AND (m.position_id IS NULL OR m.position_id NOT IN (${excludedPositions
          .map(() => "?")
          .join(",")}))`;
  db.prepare(
    `INSERT OR IGNORE INTO temp.shep_set (person_id)
      SELECT DISTINCT m.person_id
        FROM pco_team_memberships m
        JOIN pco_teams t
          ON t.org_id = m.org_id AND t.pco_id = m.team_id
       WHERE m.org_id = ?
         AND m.archived_at IS NULL
         AND m.person_id != ''
         AND t.archived_at IS NULL
         AND t.deleted_at IS NULL
         ${teamWhere}
         ${posWhere}`,
  ).run(orgId, ...excludedTeams, ...excludedPositions);

  // Source 3: dependent check-ins to NON-excluded events. By default
  // every check-in event is treated as a kid/student event; the
  // excludedCheckinEvents list pulls out the exceptions (Office
  // Visitors, Volunteer sign-ups, etc.).
  //
  // A person counts as shepherded via check-ins when:
  //   (a) ≥ shepherdedCheckinMinEvents qualifying check-ins in the window
  //   (b) EITHER they're is_minor=1 already OR at least one of those
  //       check-ins was done BY someone else (the dependent signal).
  const settings = getSyncSettings(orgId);
  const windowCutoff = new Date(
    Date.now() -
      settings.shepherdedCheckinWindowMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const excludeClause =
    excludedCheckinEvents.length === 0
      ? ""
      : `AND ci.event_id NOT IN (${excludedCheckinEvents.map(() => "?").join(",")})`;
  db.prepare(
    `INSERT OR IGNORE INTO temp.shep_set (person_id)
      SELECT ci.person_id
        FROM pco_check_ins ci
        JOIN pco_people p
          ON p.org_id = ci.org_id AND p.pco_id = ci.person_id
       WHERE ci.org_id = ?
         AND ci.person_id IS NOT NULL
         AND ci.pco_created_at >= ?
         ${excludeClause}
       GROUP BY ci.person_id
       HAVING COUNT(*) >= ?
          AND (
            MAX(p.is_minor) = 1
            OR SUM(CASE
                     WHEN ci.checked_in_by_id IS NOT NULL
                      AND ci.checked_in_by_id != ci.person_id
                     THEN 1 ELSE 0 END) > 0
          )`,
  ).run(
    orgId,
    windowCutoff,
    ...excludedCheckinEvents,
    settings.shepherdedCheckinMinEvents,
  );
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
  /** Optional: restrict to a single membership_type value. */
  membershipType?: string;
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
  populateShepherdedTempTable(opts.orgId);
  const { whereSql, whereArgs } = buildWhere(
    opts.orgId,
    opts.tab,
    cutoff,
    excluded,
    opts.membershipType,
  );
  const orderSql = buildOrderBy(opts.sort, opts.dir, cutoff);

  const rows = db
    .prepare(
      `SELECT pco_people.pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at, last_check_in_at,
              is_minor, birth_year,
              CASE WHEN s.person_id IS NOT NULL THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         ${whereSql}
         ${orderSql}
         LIMIT ? OFFSET ?`,
    )
    .all(...whereArgs, opts.limit, opts.offset) as RawRow[];
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         ${whereSql}`,
    )
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
  membershipType?: string,
): { whereSql: string; whereArgs: (string | number)[] } {
  // Note: this WHERE assumes the caller has already LEFT JOINed
  // shepherded_ids AS s. Use `s.person_id IS NOT NULL` for "shepherded".
  const parts: string[] = ["pco_people.org_id = ?"];
  const args: (string | number)[] = [orgId];

  // "active" = NOT shepherded AND has measurable activity (form submission,
  //            check-in role) within the activity window.
  // "present" = NOT shepherded, no recent activity, but PCO record edited
  //             within window (someone touched their profile).
  // "inactive" = nothing within the window.
  const ACTIVE_PREDICATE =
    `((last_form_submission_at IS NOT NULL AND last_form_submission_at >= ?)
      OR (last_check_in_at IS NOT NULL AND last_check_in_at >= ?))`;
  const NOT_ACTIVE_PREDICATE =
    `((last_form_submission_at IS NULL OR last_form_submission_at < ?)
      AND (last_check_in_at IS NULL OR last_check_in_at < ?))`;

  if (tab === "shepherded") {
    parts.push("s.person_id IS NOT NULL");
  } else if (tab === "active") {
    parts.push("s.person_id IS NULL");
    parts.push(ACTIVE_PREDICATE);
    args.push(cutoff, cutoff);
  } else if (tab === "present") {
    parts.push("s.person_id IS NULL");
    parts.push(NOT_ACTIVE_PREDICATE);
    parts.push("pco_updated_at IS NOT NULL AND pco_updated_at >= ?");
    args.push(cutoff, cutoff, cutoff);
  } else if (tab === "inactive") {
    parts.push("s.person_id IS NULL");
    parts.push(NOT_ACTIVE_PREDICATE);
    parts.push("(pco_updated_at IS NULL OR pco_updated_at < ?)");
    args.push(cutoff, cutoff, cutoff);
  } else if (tab === "all") {
    parts.push(
      `(s.person_id IS NOT NULL
         OR (last_form_submission_at IS NOT NULL AND last_form_submission_at >= ?)
         OR (last_check_in_at IS NOT NULL AND last_check_in_at >= ?)
         OR (pco_updated_at IS NOT NULL AND pco_updated_at >= ?))`,
    );
    args.push(cutoff, cutoff, cutoff);
  }

  if (excludedTypes.length > 0) {
    const placeholders = excludedTypes.map(() => "?").join(",");
    parts.push(`(membership_type IS NULL OR membership_type NOT IN (${placeholders}))`);
    args.push(...excludedTypes);
  }

  // Optional UI filter: pin the list to one membership_type.
  if (membershipType) {
    if (membershipType === "__none__") {
      parts.push("membership_type IS NULL");
    } else {
      parts.push("membership_type = ?");
      args.push(membershipType);
    }
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
          WHEN last_check_in_at IS NOT NULL AND last_check_in_at >= '${cutoff}' THEN 2
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
  /** Subset of each bucket that is currently a minor (is_minor=1). Lets
   *  the UI show "1500 (+200 kids)" so the adult-only number is the
   *  headline for outreach/next-steps work. */
  shepherdedKids: number;
  activeKids: number;
  presentKids: number;
  inactiveKids: number;
  /** Total minus inactive — what "All" shows by default. */
  visibleByDefault: number;
}

/** React.cache so sections that both want the classification counts
 *  on the home page (the top stat strip + the people-mix pie) hit one
 *  query instead of two. */
export const getClassificationCounts = cache(getClassificationCountsImpl);

function getClassificationCountsImpl(
  orgId: number,
  activityMonths: number,
  membershipType?: string,
): ClassificationCounts {
  // Snapshot fast path. Only valid when the snapshot was built with
  // the same activity-month threshold AND no membership filter is
  // active (the snapshot is org-wide). With a membership filter set
  // we always run the live CASE-laden SQL with the extra predicate.
  const snap = membershipType ? null : getOrgSnapshot(orgId);
  if (snap && snap.activityMonths === activityMonths) {
    let { shepherdedKids, activeKids, presentKids, inactiveKids } = snap;
    // Self-heal: when migration 0037 added the kid columns it
    // backfilled them to 0 on the existing snapshot row, so the kid
    // breakdown vanishes until the next full refresh runs. If all
    // four are 0 but there ARE people, the columns are almost
    // certainly stale (a real church has minors) — recompute them
    // once from person_activity. This is a single indexed GROUP BY,
    // cheap, and only fires until the next refresh persists real
    // values.
    const kidsAllZero =
      shepherdedKids === 0 &&
      activeKids === 0 &&
      presentKids === 0 &&
      inactiveKids === 0;
    if (kidsAllZero && snap.totalPeople > 0) {
      const k = getDb()
        .prepare(
          `SELECT
             SUM(CASE WHEN pa.classification = 'shepherded'
                       AND p.is_minor = 1 THEN 1 ELSE 0 END) AS shepherdedKids,
             SUM(CASE WHEN pa.classification = 'active'
                       AND p.is_minor = 1 THEN 1 ELSE 0 END) AS activeKids,
             SUM(CASE WHEN pa.classification = 'present'
                       AND p.is_minor = 1 THEN 1 ELSE 0 END) AS presentKids,
             SUM(CASE WHEN pa.classification = 'inactive'
                       AND p.is_minor = 1 THEN 1 ELSE 0 END) AS inactiveKids
             FROM person_activity pa
             JOIN pco_people p
               ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
            WHERE pa.org_id = ?`,
        )
        .get(orgId) as {
        shepherdedKids: number | null;
        activeKids: number | null;
        presentKids: number | null;
        inactiveKids: number | null;
      };
      shepherdedKids = k.shepherdedKids ?? 0;
      activeKids = k.activeKids ?? 0;
      presentKids = k.presentKids ?? 0;
      inactiveKids = k.inactiveKids ?? 0;
    }
    return {
      total: snap.totalPeople,
      shepherded: snap.shepherdedCount,
      active: snap.activeCount,
      present: snap.presentCount,
      inactive: snap.inactiveCount,
      shepherdedKids,
      activeKids,
      presentKids,
      inactiveKids,
      visibleByDefault: snap.totalPeople - snap.inactiveCount,
    };
  }
  const db = getDb();
  const cutoff = cutoffIso(activityMonths);
  const excluded = getExcludedMembershipTypes(orgId);
  const exclSql =
    excluded.length === 0
      ? ""
      : ` AND (membership_type IS NULL OR membership_type NOT IN (${excluded.map(() => "?").join(",")}))`;
  // Optional UI membership filter — pins the whole stat strip / tabs /
  // header to one membership type. "__none__" picks the rows PCO left
  // blank, matching the convention in listPeople.buildWhere.
  let memSql = "";
  const memArgs: string[] = [];
  if (membershipType === "__none__") {
    memSql = " AND membership_type IS NULL";
  } else if (membershipType) {
    memSql = " AND membership_type = ?";
    memArgs.push(membershipType);
  }
  // Precompute shepherded set into a TEMP TABLE (with PRIMARY KEY) so the
  // LEFT JOIN below is indexed instead of a full scan per pco_people row.
  populateShepherdedTempTable(orgId);
  // "Active" = NOT shepherded AND (form submission OR check-in role) in window.
  // "Present" = NOT shepherded, NOT active, but PCO record edited in window.
  // "Inactive" = NOT shepherded AND nothing in window.
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN s.person_id IS NOT NULL THEN 1 ELSE 0 END) AS shepherded,
         SUM(CASE WHEN s.person_id IS NOT NULL AND is_minor = 1 THEN 1 ELSE 0 END) AS shepherdedKids,
         SUM(CASE
               WHEN s.person_id IS NULL
                AND ((last_form_submission_at IS NOT NULL AND last_form_submission_at >= ?)
                  OR (last_check_in_at IS NOT NULL AND last_check_in_at >= ?))
               THEN 1 ELSE 0 END) AS active,
         SUM(CASE
               WHEN s.person_id IS NULL
                AND is_minor = 1
                AND ((last_form_submission_at IS NOT NULL AND last_form_submission_at >= ?)
                  OR (last_check_in_at IS NOT NULL AND last_check_in_at >= ?))
               THEN 1 ELSE 0 END) AS activeKids,
         SUM(CASE
               WHEN s.person_id IS NULL
                AND (last_form_submission_at IS NULL OR last_form_submission_at < ?)
                AND (last_check_in_at IS NULL OR last_check_in_at < ?)
                AND pco_updated_at IS NOT NULL
                AND pco_updated_at >= ?
               THEN 1 ELSE 0 END) AS present,
         SUM(CASE
               WHEN s.person_id IS NULL
                AND is_minor = 1
                AND (last_form_submission_at IS NULL OR last_form_submission_at < ?)
                AND (last_check_in_at IS NULL OR last_check_in_at < ?)
                AND pco_updated_at IS NOT NULL
                AND pco_updated_at >= ?
               THEN 1 ELSE 0 END) AS presentKids,
         SUM(CASE
               WHEN s.person_id IS NULL
                AND (last_form_submission_at IS NULL OR last_form_submission_at < ?)
                AND (last_check_in_at IS NULL OR last_check_in_at < ?)
                AND (pco_updated_at IS NULL OR pco_updated_at < ?)
               THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE
               WHEN s.person_id IS NULL
                AND is_minor = 1
                AND (last_form_submission_at IS NULL OR last_form_submission_at < ?)
                AND (last_check_in_at IS NULL OR last_check_in_at < ?)
                AND (pco_updated_at IS NULL OR pco_updated_at < ?)
               THEN 1 ELSE 0 END) AS inactiveKids
       FROM pco_people
       LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
       WHERE pco_people.org_id = ?${exclSql}${memSql}`,
    )
    .get(
      cutoff, cutoff,            // active total
      cutoff, cutoff,            // activeKids
      cutoff, cutoff, cutoff,    // present total
      cutoff, cutoff, cutoff,    // presentKids
      cutoff, cutoff, cutoff,    // inactive total
      cutoff, cutoff, cutoff,    // inactiveKids
      orgId,
      ...excluded,
      ...memArgs,
    ) as {
    total: number;
    shepherded: number | null;
    shepherdedKids: number | null;
    active: number | null;
    activeKids: number | null;
    present: number | null;
    presentKids: number | null;
    inactive: number | null;
    inactiveKids: number | null;
  };
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
    shepherdedKids: row.shepherdedKids ?? 0,
    activeKids: row.activeKids ?? 0,
    presentKids: row.presentKids ?? 0,
    inactiveKids: row.inactiveKids ?? 0,
    visibleByDefault: row.total - inactive,
  };
}

// ─── Single-person fetch (for the profile page) ────────────────────────

export function getPersonByPcoId(
  orgId: number,
  pcoId: string,
  activityMonths: number,
): SyncedPersonRow | null {
  const db = getDb();
  // Snapshot fast path: if person_activity has a row for this person
  // we already know whether they're shepherded (active group / team
  // count > 0). Skipping populateShepherdedTempTable here saves the
  // multi-table scan that used to run on EVERY profile page load —
  // that scan was the dominant blocker for /people/[slug] paint.
  const fast = db
    .prepare(
      `SELECT CASE WHEN active_group_count > 0
                    OR active_team_count > 0
                   THEN 1 ELSE 0 END AS isShepherded
         FROM person_activity
        WHERE org_id = ? AND person_id = ?`,
    )
    .get(orgId, pcoId) as { isShepherded: number } | undefined;

  if (fast) {
    const row = db
      .prepare(
        `SELECT pco_id, enc_pii, gender, membership_type, marital_status,
                pco_created_at, pco_updated_at, last_form_submission_at,
                last_check_in_at, is_minor, birth_year,
                ? AS is_shepherded
           FROM pco_people
          WHERE org_id = ? AND pco_id = ?`,
      )
      .get(fast.isShepherded, orgId, pcoId) as RawRow | undefined;
    if (!row) return null;
    return toRow(row, activityMonths);
  }

  // Cold-start fallback — no snapshot row for this person yet. Run
  // the old temp-table path so the page still works on a fresh
  // install / before the first refresh.
  populateShepherdedTempTable(orgId);
  const row = db
    .prepare(
      `SELECT pco_people.pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at, last_check_in_at,
              is_minor, birth_year,
              CASE WHEN s.person_id IS NOT NULL THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         WHERE pco_people.org_id = ? AND pco_people.pco_id = ?`,
    )
    .get(orgId, pcoId) as RawRow | undefined;
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
  populateShepherdedTempTable(orgId);
  const rows = getDb()
    .prepare(
      `SELECT pco_people.pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at, last_check_in_at,
              is_minor, birth_year,
              CASE WHEN s.person_id IS NOT NULL THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         WHERE pco_people.org_id = ?`,
    )
    .all(orgId) as RawRow[];
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
