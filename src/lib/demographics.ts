import "server-only";
import { getDb } from "./db";

export type DemographicScope = "all" | "groups" | "teams";

export interface DemographicSnapshot {
  /** Total people in scope (i.e. denominator for percentages). */
  total: number;
  /** Membership type counts, biggest first. */
  membershipBuckets: Array<{ label: string; count: number }>;
  /** Age buckets keyed by label, in display order. NULLs/unknown bucketed
   *  to "Unknown". Computed from pco_people.birth_year (denormalized at
   *  sync time from the encrypted birthdate). */
  ageBuckets: Array<{ label: string; count: number }>;
  /** Gender counts: male / female / unknown. */
  genderBuckets: Array<{ label: string; count: number }>;
  /** How many in the scope had a usable birthdate. Surfaced so the age
   *  curve can show coverage in the subtitle. */
  totalWithBirthYear: number;
  /** Same idea for gender. */
  totalWithGender: number;
}

const AGE_BANDS: Array<{ label: string; max: number }> = [
  { label: "0–5", max: 5 },
  { label: "6–12", max: 12 },
  { label: "13–17", max: 17 },
  { label: "18–25", max: 25 },
  { label: "26–35", max: 35 },
  { label: "36–50", max: 50 },
  { label: "51–65", max: 65 },
  { label: "66+", max: 200 },
];

/** Returns membership / age / gender breakdowns for the people in scope.
 *  scope:
 *    - "all"    → every pco_people row.
 *    - "groups" → distinct people in an active membership of any
 *                 (non-excluded) active group.
 *    - "teams"  → distinct people on the active roster of a non-archived,
 *                 non-excluded team. */
export function getDemographics(
  orgId: number,
  scope: DemographicScope,
): DemographicSnapshot {
  const db = getDb();
  const { fromSql, args } = scopeClause(scope, orgId);
  const now = new Date();
  const thisYear = now.getUTCFullYear();

  // Membership types
  const membershipRows = db
    .prepare(
      `SELECT coalesce(membership_type, '(unknown)') AS label,
              COUNT(*) AS count
         FROM ${fromSql}
         GROUP BY membership_type
         ORDER BY COUNT(*) DESC, membership_type ASC`,
    )
    .all(...args) as Array<{ label: string; count: number }>;

  // Gender
  const genderRows = db
    .prepare(
      `SELECT
         CASE
           WHEN lower(coalesce(gender, '')) IN ('m', 'male') THEN 'Male'
           WHEN lower(coalesce(gender, '')) IN ('f', 'female') THEN 'Female'
           ELSE 'Unknown'
         END AS label,
         COUNT(*) AS count
       FROM ${fromSql}
       GROUP BY label`,
    )
    .all(...args) as Array<{ label: string; count: number }>;

  // Age buckets — compute from birth_year in SQL with a CASE.
  const caseClauses = AGE_BANDS.map(
    (band) => `WHEN (${thisYear} - birth_year) <= ${band.max} THEN '${band.label}'`,
  ).join("\n");
  const ageRows = db
    .prepare(
      `SELECT
         CASE
           WHEN birth_year IS NULL OR birth_year < 1900 THEN 'Unknown'
           ${caseClauses}
           ELSE 'Unknown'
         END AS label,
         COUNT(*) AS count
       FROM ${fromSql}
       GROUP BY label`,
    )
    .all(...args) as Array<{ label: string; count: number }>;

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM ${fromSql}`)
    .get(...args) as { n: number };
  const total = totalRow.n;

  // Re-order age buckets to canonical sequence (Unknown last).
  const ageByLabel = new Map(ageRows.map((r) => [r.label, r.count]));
  const orderedAge: Array<{ label: string; count: number }> = [
    ...AGE_BANDS.map((b) => ({
      label: b.label,
      count: ageByLabel.get(b.label) ?? 0,
    })),
    { label: "Unknown", count: ageByLabel.get("Unknown") ?? 0 },
  ];

  // Same for gender — canonical M / F / Unknown.
  const genderByLabel = new Map(genderRows.map((r) => [r.label, r.count]));
  const orderedGender = ["Male", "Female", "Unknown"].map((label) => ({
    label,
    count: genderByLabel.get(label) ?? 0,
  }));

  const totalWithBirthYear = orderedAge
    .filter((b) => b.label !== "Unknown")
    .reduce((s, b) => s + b.count, 0);
  const totalWithGender =
    (genderByLabel.get("Male") ?? 0) + (genderByLabel.get("Female") ?? 0);

  return {
    total,
    membershipBuckets: membershipRows,
    ageBuckets: orderedAge,
    genderBuckets: orderedGender,
    totalWithBirthYear,
    totalWithGender,
  };
}

/** Build the FROM clause for a given scope. Returns SQL fragment + args.
 *  All three scopes resolve to a row source we can group from. */
function scopeClause(
  scope: DemographicScope,
  orgId: number,
): { fromSql: string; args: (string | number)[] } {
  if (scope === "all") {
    return {
      fromSql: `(SELECT * FROM pco_people WHERE org_id = ?) AS s`,
      args: [orgId],
    };
  }
  if (scope === "groups") {
    return {
      fromSql: `(
        SELECT p.*
        FROM pco_people p
        WHERE p.org_id = ?
          AND EXISTS (
            SELECT 1 FROM pco_group_memberships m
            JOIN pco_groups g
              ON g.org_id = m.org_id AND g.pco_id = m.group_id
            WHERE m.org_id = p.org_id
              AND m.person_id = p.pco_id
              AND m.archived_at IS NULL
              AND g.archived_at IS NULL
          )
      ) AS s`,
      args: [orgId],
    };
  }
  // scope === "teams"
  return {
    fromSql: `(
      SELECT p.*
      FROM pco_people p
      WHERE p.org_id = ?
        AND EXISTS (
          SELECT 1 FROM pco_team_memberships m
          JOIN pco_teams t
            ON t.org_id = m.org_id AND t.pco_id = m.team_id
          WHERE m.org_id = p.org_id
            AND m.person_id = p.pco_id
            AND m.archived_at IS NULL
            AND t.archived_at IS NULL
            AND t.deleted_at IS NULL
        )
    ) AS s`,
    args: [orgId],
  };
}
