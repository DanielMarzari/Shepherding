import "server-only";
import { cache } from "react";
import { getOrgSnapshot } from "./dashboard-refresh";
import { getDb } from "./db";
import { type Classification, classOf } from "./classification";
import { decryptJson, hmac } from "./encryption";
import { normPhone } from "./phone";
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
/** Re-exported so callers keep importing it from here, but there is only
 *  one definition now — see classification.ts. */
export type ActivityClassification = Classification;

export type SortColumn =
  | "updated"
  | "created"
  | "membership"
  | "status"
  | "age"
  | "name";
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
  /** Plaintext names (0074) — present when the query selects them; used to
   *  skip decrypting enc_pii just to read a name. */
  first_name?: string | null;
  last_name?: string | null;
  gender: string | null;
  membership_type: string | null;
  marital_status: string | null;
  pco_created_at: string | null;
  pco_updated_at: string | null;
  last_form_submission_at: string | null;
  last_check_in_at: string | null;
  is_shepherded: number;
  /** person_activity.classification. The snapshot is the single source of
   *  truth for the band; the live computation below is only a fallback for
   *  people the snapshot has not seen yet. */
  snapshot_classification?: string | null;
  is_minor: number;
  birth_year: number | null;
}

function cutoffIso(activityMonths: number): string {
  return new Date(
    Date.now() - activityMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** The band for one row, straight from the snapshot.
 *
 *  There is no live fallback. The snapshot weighs every activity signal the
 *  church has configured — giving, email opens, registrations and the rest
 *  — which cannot be reproduced from the handful of columns this query
 *  selects, and a second implementation of the rule is how /people and
 *  /audit came to disagree about the same person in the first place.
 *
 *  It is rebuilt at the end of every sync, so the only people it has not
 *  seen are those added in the minutes between a sync finishing and the
 *  next one starting. They read as unknown, which is exactly what they are
 *  to us. */
function classify(snapshot: string | null | undefined): ActivityClassification {
  return classOf(snapshot);
}

function toRow(r: RawRow): SyncedPersonRow {
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
    classification: classify(r.snapshot_classification),
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
  // We now sync archived groups too, so join pco_groups and require
  // g.archived_at IS NULL — a membership in a long-dead group is history,
  // not present-day shepherding.
  if (excludedGroups.length === 0) {
    db.prepare(
      `INSERT OR IGNORE INTO temp.shep_set (person_id)
        SELECT DISTINCT m.person_id
          FROM pco_group_memberships m
          JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
         WHERE m.org_id = ?
           AND m.archived_at IS NULL
           AND g.archived_at IS NULL`,
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
           AND g.archived_at IS NULL
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
  const selectCols = `pco_people.pco_id, enc_pii, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at, last_check_in_at,
              is_minor, birth_year,
              CASE WHEN s.person_id IS NOT NULL THEN 1 ELSE 0 END AS is_shepherded,
              pa.classification AS snapshot_classification`;

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         LEFT JOIN person_activity pa
           ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
         ${whereSql}`,
    )
    .get(...whereArgs) as { n: number };

  // Name sort can't happen in SQL (names are encrypted). When it's
  // requested we fetch ALL matching rows, decrypt + sort by full name
  // in JS, then slice to the page. This is the same full-decrypt the
  // search box already does; it only runs when the user explicitly
  // sorts by name, so the default (fast, SQL-paginated) path is
  // unaffected.
  if (opts.sort === "name") {
    const allRows = db
      .prepare(
        `SELECT ${selectCols}
           FROM pco_people
           LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
           LEFT JOIN person_activity pa
             ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
         LEFT JOIN person_activity pa
           ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
           ${whereSql}`,
      )
      .all(...whereArgs) as RawRow[];
    const mapped = allRows.map((r) => toRow(r));
    const factor = opts.dir === "asc" ? 1 : -1;
    mapped.sort(
      (a, b) => a.fullName.localeCompare(b.fullName) * factor,
    );
    return {
      rows: mapped.slice(opts.offset, opts.offset + opts.limit),
      total: totalRow.n,
      pageSize: opts.limit,
      page: Math.floor(opts.offset / opts.limit) + 1,
    };
  }

  const orderSql = buildOrderBy(opts.sort, opts.dir, cutoff);
  const rows = db
    .prepare(
      `SELECT ${selectCols}
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         LEFT JOIN person_activity pa
           ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
         ${whereSql}
         ${orderSql}
         LIMIT ? OFFSET ?`,
    )
    .all(...whereArgs, opts.limit, opts.offset) as RawRow[];
  return {
    rows: rows.map((r) => toRow(r)),
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

  // Tabs read the snapshot's verdict and nothing else. "all" means
  // everybody we would show anywhere, which is Shepherded or Known — the
  // Unknown tab is where the rest live, and all-incl-inactive is the
  // escape hatch for seeing the whole database.
  if (tab === "shepherded" || tab === "known" || tab === "unknown") {
    parts.push("pa.classification = ?");
    args.push(tab);
  } else if (tab === "all") {
    parts.push("pa.classification IN ('shepherded','known')");
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
    case "age":
      // The Age column only shows a Kid / Adult badge (driven by
      // is_minor), so the sort groups by that SAME flag — otherwise a
      // minor flagged via a kids-event check-in but with no birthdate
      // on file (birth_year NULL) would sort to the very end and the
      // "kids" would seem to vanish, even though the count says they
      // exist. DESC = kids first; within each group, birth_year orders
      // youngest/oldest, NULLs last.
      return `ORDER BY is_minor ${direction}, birth_year ${direction} ${nulls}, pco_updated_at DESC`;
    case "name":
      // Names live encrypted in enc_pii — they can't be ORDER BY'd in
      // SQL. listPeople detects sort === "name" and takes a
      // decrypt-then-sort path instead; this ORDER BY is only the
      // fallback shape and never actually used for name.
      return `ORDER BY pco_updated_at DESC ${nulls}`;
    default:
      return `ORDER BY pco_updated_at DESC ${nulls}`;
  }
}

export interface ClassificationCounts {
  total: number;
  shepherded: number;
  known: number;
  unknown: number;
  /** Subset of each bucket that is currently a minor (is_minor=1). Lets
   *  the UI show "1500 (+200 kids)" so the adult-only number is the
   *  headline for outreach/next-steps work. */
  shepherdedKids: number;
  knownKids: number;
  unknownKids: number;
  /** Shepherded + Known — what "All" shows by default. */
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
    let { shepherdedKids, knownKids, unknownKids } = snap;
    // Self-heal: a migration that adds a kid column backfills it to 0, so
    // the breakdown vanishes until the next full refresh. If all three are
    // 0 but there ARE people, the columns are stale (a real church has
    // minors) — recompute once from person_activity. One indexed GROUP BY,
    // and it stops firing as soon as a refresh persists real values.
    const kidsAllZero =
      shepherdedKids === 0 && knownKids === 0 && unknownKids === 0;
    if (kidsAllZero && snap.totalPeople > 0) {
      const k = getDb()
        .prepare(
          `SELECT
             SUM(CASE WHEN pa.classification = 'shepherded'
                       AND p.is_minor = 1 THEN 1 ELSE 0 END) AS shepherdedKids,
             SUM(CASE WHEN pa.classification = 'known'
                       AND p.is_minor = 1 THEN 1 ELSE 0 END) AS knownKids,
             SUM(CASE WHEN pa.classification = 'unknown'
                       AND p.is_minor = 1 THEN 1 ELSE 0 END) AS unknownKids
             FROM person_activity pa
             JOIN pco_people p
               ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
            WHERE pa.org_id = ?`,
        )
        .get(orgId) as {
        shepherdedKids: number | null;
        knownKids: number | null;
        unknownKids: number | null;
      };
      shepherdedKids = k.shepherdedKids ?? 0;
      knownKids = k.knownKids ?? 0;
      unknownKids = k.unknownKids ?? 0;
    }
    return {
      total: snap.totalPeople,
      shepherded: snap.shepherdedCount,
      known: snap.knownCount,
      unknown: snap.unknownCount,
      shepherdedKids,
      knownKids,
      unknownKids,
      visibleByDefault: snap.shepherdedCount + snap.knownCount,
    };
  }
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
  // Counts come from the snapshot, same as everything else. This used to
  // be a CASE-laden query that re-derived the classification from form
  // submissions, check-ins and pco_updated_at — a second implementation of
  // a rule that now weighs seven configurable signals, and which could
  // therefore disagree with every other page in the app.
  //
  // It runs only when the org-wide snapshot cannot answer: a membership
  // filter is set, or the snapshot was built against a different activity
  // window. Both cases still read person_activity; only the filter differs.
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN pa.classification = 'shepherded' THEN 1 ELSE 0 END) AS shepherded,
         SUM(CASE WHEN pa.classification = 'shepherded'
                   AND is_minor = 1 THEN 1 ELSE 0 END) AS shepherdedKids,
         SUM(CASE WHEN pa.classification = 'known' THEN 1 ELSE 0 END) AS known,
         SUM(CASE WHEN pa.classification = 'known'
                   AND is_minor = 1 THEN 1 ELSE 0 END) AS knownKids,
         -- NULL counts as unknown: somebody synced since the last refresh
         -- genuinely is unknown to us.
         SUM(CASE WHEN pa.classification IS NULL
                    OR pa.classification = 'unknown' THEN 1 ELSE 0 END) AS unknown,
         SUM(CASE WHEN (pa.classification IS NULL OR pa.classification = 'unknown')
                   AND is_minor = 1 THEN 1 ELSE 0 END) AS unknownKids
       FROM pco_people
       LEFT JOIN person_activity pa
         ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
       WHERE pco_people.org_id = ?${exclSql}${memSql}`,
    )
    .get(orgId, ...excluded, ...memArgs) as {
    total: number;
    shepherded: number | null;
    shepherdedKids: number | null;
    known: number | null;
    knownKids: number | null;
    unknown: number | null;
    unknownKids: number | null;
  };
  const shepherded = row.shepherded ?? 0;
  const known = row.known ?? 0;
  return {
    total: row.total,
    shepherded,
    known,
    unknown: row.unknown ?? 0,
    shepherdedKids: row.shepherdedKids ?? 0,
    knownKids: row.knownKids ?? 0,
    unknownKids: row.unknownKids ?? 0,
    visibleByDefault: shepherded + known,
  };
}

// ─── Single-person fetch (for the profile page) ────────────────────────

export function getPersonByPcoId(
  orgId: number,
  pcoId: string,
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
    return toRow(row);
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
         LEFT JOIN person_activity pa
           ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
         WHERE pco_people.org_id = ? AND pco_people.pco_id = ?`,
    )
    .get(orgId, pcoId) as RawRow | undefined;
  if (!row) return null;
  return toRow(row);
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

/** Build SearchHits for a specific set of person ids (used by the email/phone
 *  lookups, which resolve exact ids by hash first). */
function hitsForIds(orgId: number, ids: string[], activityMonths: number, limit: number): SearchHit[] {
  if (ids.length === 0) return [];
  const capped = ids.slice(0, limit);
  populateShepherdedTempTable(orgId);
  const ph = capped.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT pco_people.pco_id, enc_pii, first_name, last_name, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at, last_check_in_at,
              is_minor, birth_year,
              CASE WHEN s.person_id IS NOT NULL THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         LEFT JOIN person_activity pa
           ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
        WHERE pco_people.org_id = ? AND pco_people.pco_id IN (${ph})`,
    )
    .all(orgId, ...capped) as RawRow[];
  return rows.map((r) => {
    const p = toRow(r);
    return { pcoId: p.pcoId, fullName: p.fullName, initials: p.initials, classification: p.classification, membershipType: p.membershipType };
  });
}

/** Search people by name, or — when the query looks like an email or phone —
 *  by an exact hashed lookup against pco_person_emails / pco_person_phones
 *  (email/phone are never stored in plaintext, so only exact matches resolve).
 *  This is how you find organizations and anyone whose name is odd. With ~33k
 *  rows the name path takes ~50-150ms; the contact paths are indexed lookups. */
export function searchPeople(
  orgId: number,
  query: string,
  activityMonths: number,
  limit = 8,
): SearchHit[] {
  const raw = query.trim();
  if (raw.length < 2) return [];
  const db = getDb();

  // Email → exact hash lookup.
  if (raw.includes("@")) {
    const ids = (
      db.prepare(`SELECT DISTINCT person_id FROM pco_person_emails WHERE org_id = ? AND email_hash = ?`)
        .all(orgId, hmac(raw.toLowerCase())) as Array<{ person_id: string }>
    ).map((r) => r.person_id);
    return hitsForIds(orgId, ids, activityMonths, limit);
  }
  // Phone → normalize + exact hash lookup (only when it's clearly a phone).
  const digits = raw.replace(/\D+/g, "");
  const np = normPhone(raw);
  if (np && digits.length >= 7) {
    const ids = (
      db.prepare(`SELECT DISTINCT person_id FROM pco_person_phones WHERE org_id = ? AND phone_hash = ?`)
        .all(orgId, hmac(np)) as Array<{ person_id: string }>
    ).map((r) => r.person_id);
    return hitsForIds(orgId, ids, activityMonths, limit);
  }

  const q = raw.toLowerCase();
  populateShepherdedTempTable(orgId);
  const db2 = getDb();

  // Fast path: filter on the plaintext name columns (0074) inside SQL with a
  // LIMIT, so we return ≤limit rows instead of loading all ~33k into JS on
  // every keystroke. Escape LIKE wildcards in the query.
  const like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const fast = db2
    .prepare(
      `SELECT pco_people.pco_id, enc_pii, first_name, last_name, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at, last_check_in_at,
              is_minor, birth_year,
              CASE WHEN s.person_id IS NOT NULL THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         LEFT JOIN person_activity pa
           ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
        WHERE pco_people.org_id = ?
          AND ( lower(first_name) LIKE ? ESCAPE '\\'
                OR lower(last_name) LIKE ? ESCAPE '\\'
                OR lower(first_name || ' ' || last_name) LIKE ? ESCAPE '\\' )
        LIMIT ?`,
    )
    .all(orgId, like, like, like, limit) as RawRow[];
  if (fast.length > 0 || namesBackfilled(orgId)) {
    return fast.map((r) => {
      const p = toRow(r);
      return { pcoId: p.pcoId, fullName: p.fullName, initials: p.initials, classification: p.classification, membershipType: p.membershipType };
    });
  }

  // Fallback (only while names aren't backfilled yet — right after the 0074
  // deploy, before the next sync): the original decrypt-and-scan.
  const rows = db2
    .prepare(
      `SELECT pco_people.pco_id, enc_pii, first_name, last_name, gender, membership_type, marital_status,
              pco_created_at, pco_updated_at, last_form_submission_at, last_check_in_at,
              is_minor, birth_year,
              CASE WHEN s.person_id IS NOT NULL THEN 1 ELSE 0 END AS is_shepherded
         FROM pco_people
         LEFT JOIN temp.shep_set s ON s.person_id = pco_people.pco_id
         LEFT JOIN person_activity pa
           ON pa.org_id = pco_people.org_id AND pa.person_id = pco_people.pco_id
         WHERE pco_people.org_id = ?`,
    )
    .all(orgId) as RawRow[];
  const hits: SearchHit[] = [];
  for (const r of rows) {
    let haystack: string;
    if (r.first_name != null || r.last_name != null) {
      haystack = `${r.first_name ?? ""} ${r.last_name ?? ""}`.toLowerCase();
    } else {
      const pii = decryptJson<PIIBlob>(r.enc_pii) ?? {};
      haystack = `${pii.first_name ?? ""} ${pii.last_name ?? ""}`.toLowerCase();
    }
    if (haystack.includes(q)) {
      const person = toRow(r);
      hits.push({ pcoId: person.pcoId, fullName: person.fullName, initials: person.initials, classification: person.classification, membershipType: person.membershipType });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** True when every person has a plaintext name (0074 backfill complete), so
 *  the fast SQL name search can be trusted to return everything. Cached per
 *  request. */
const namesBackfilled = cache((orgId: number): boolean => {
  const r = getDb().prepare(`SELECT 1 FROM pco_people WHERE org_id = ? AND first_name IS NULL AND enc_pii IS NOT NULL LIMIT 1`).get(orgId);
  return !r;
});
