import "server-only";
import { getDb } from "./db";

export type DemographicScope =
  | { kind: "all" }
  | { kind: "groups" }
  | { kind: "teams" }
  | { kind: "group"; id: string }
  | { kind: "team"; id: string }
  | { kind: "groupType"; id: string }
  | { kind: "serviceType"; id: string };

export interface DemographicSnapshot {
  total: number;
  membershipBuckets: Array<{ label: string; count: number }>;
  ageBuckets: Array<{ label: string; count: number }>;
  genderBuckets: Array<{ label: string; count: number }>;
  hasKidsBuckets: Array<{ label: string; count: number }>;
  totalWithBirthYear: number;
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

/** Populate a connection-local TEMP TABLE with the set of person_ids that
 *  match a given scope. Subsequent queries can JOIN against this temp set
 *  via an O(log N) indexed lookup instead of re-evaluating an EXISTS
 *  subquery per row. Returns the table name to JOIN against. */
export function populatePeopleInScope(
  orgId: number,
  scope: DemographicScope,
): string {
  const db = getDb();
  const tableName = "people_scope";
  db.exec(
    `CREATE TEMP TABLE IF NOT EXISTS ${tableName} (person_id TEXT PRIMARY KEY)`,
  );
  db.exec(`DELETE FROM temp.${tableName}`);

  switch (scope.kind) {
    case "all":
      db.prepare(
        `INSERT OR IGNORE INTO temp.${tableName} (person_id)
           SELECT pco_id FROM pco_people WHERE org_id = ?`,
      ).run(orgId);
      break;
    case "groups":
      db.prepare(
        `INSERT OR IGNORE INTO temp.${tableName} (person_id)
           SELECT DISTINCT m.person_id
             FROM pco_group_memberships m
             JOIN pco_groups g
               ON g.org_id = m.org_id AND g.pco_id = m.group_id
            WHERE m.org_id = ?
              AND m.archived_at IS NULL
              AND g.archived_at IS NULL`,
      ).run(orgId);
      break;
    case "teams":
      db.prepare(
        `INSERT OR IGNORE INTO temp.${tableName} (person_id)
           SELECT DISTINCT m.person_id
             FROM pco_team_memberships m
             JOIN pco_teams t
               ON t.org_id = m.org_id AND t.pco_id = m.team_id
            WHERE m.org_id = ?
              AND m.archived_at IS NULL
              AND m.person_id != ''
              AND t.archived_at IS NULL
              AND t.deleted_at IS NULL`,
      ).run(orgId);
      break;
    case "group":
      db.prepare(
        `INSERT OR IGNORE INTO temp.${tableName} (person_id)
           SELECT DISTINCT person_id
             FROM pco_group_memberships
            WHERE org_id = ? AND group_id = ? AND archived_at IS NULL`,
      ).run(orgId, scope.id);
      break;
    case "team":
      db.prepare(
        `INSERT OR IGNORE INTO temp.${tableName} (person_id)
           SELECT DISTINCT person_id
             FROM pco_team_memberships
            WHERE org_id = ? AND team_id = ? AND archived_at IS NULL AND person_id != ''`,
      ).run(orgId, scope.id);
      break;
    case "groupType":
      db.prepare(
        `INSERT OR IGNORE INTO temp.${tableName} (person_id)
           SELECT DISTINCT m.person_id
             FROM pco_group_memberships m
             JOIN pco_groups g
               ON g.org_id = m.org_id AND g.pco_id = m.group_id
            WHERE m.org_id = ?
              AND m.archived_at IS NULL
              AND g.archived_at IS NULL
              AND coalesce(g.group_type_id, '') = ?`,
      ).run(orgId, scope.id);
      break;
    case "serviceType":
      db.prepare(
        `INSERT OR IGNORE INTO temp.${tableName} (person_id)
           SELECT DISTINCT m.person_id
             FROM pco_team_memberships m
             JOIN pco_teams t
               ON t.org_id = m.org_id AND t.pco_id = m.team_id
            WHERE m.org_id = ?
              AND m.archived_at IS NULL
              AND m.person_id != ''
              AND t.archived_at IS NULL
              AND t.deleted_at IS NULL
              AND coalesce(t.service_type_id, '') = ?`,
      ).run(orgId, scope.id);
      break;
  }
  return tableName;
}

export function getDemographics(
  orgId: number,
  scope: DemographicScope,
): DemographicSnapshot {
  const db = getDb();
  populatePeopleInScope(orgId, scope);
  const thisYear = new Date().getUTCFullYear();
  // Everything reads from pco_people via the scoped temp table — one
  // indexed inner-join, no per-row EXISTS work.
  const baseFrom = `pco_people p
    JOIN temp.people_scope s ON s.person_id = p.pco_id
    WHERE p.org_id = ?`;

  const membershipRows = db
    .prepare(
      `SELECT coalesce(p.membership_type, '(unknown)') AS label,
              COUNT(*) AS count
         FROM ${baseFrom}
         GROUP BY p.membership_type
         ORDER BY COUNT(*) DESC, p.membership_type ASC`,
    )
    .all(orgId) as Array<{ label: string; count: number }>;

  const genderRows = db
    .prepare(
      `SELECT
         CASE
           WHEN lower(coalesce(p.gender, '')) IN ('m', 'male') THEN 'Male'
           WHEN lower(coalesce(p.gender, '')) IN ('f', 'female') THEN 'Female'
           ELSE 'Unknown'
         END AS label,
         COUNT(*) AS count
       FROM ${baseFrom}
       GROUP BY label`,
    )
    .all(orgId) as Array<{ label: string; count: number }>;

  const caseClauses = AGE_BANDS.map(
    (band) => `WHEN (${thisYear} - p.birth_year) <= ${band.max} THEN '${band.label}'`,
  ).join("\n");
  const ageRows = db
    .prepare(
      `SELECT
         CASE
           WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 'Unknown'
           ${caseClauses}
           ELSE 'Unknown'
         END AS label,
         COUNT(*) AS count
       FROM ${baseFrom}
       GROUP BY label`,
    )
    .all(orgId) as Array<{ label: string; count: number }>;

  const kidsRows = db
    .prepare(
      `SELECT
         CASE
           WHEN p.is_minor = 1 OR p.birth_year IS NULL THEN 'Unknown'
           WHEN p.is_parent = 1 THEN 'Has kids'
           ELSE 'No kids'
         END AS label,
         COUNT(*) AS count
       FROM ${baseFrom}
       GROUP BY label`,
    )
    .all(orgId) as Array<{ label: string; count: number }>;

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM ${baseFrom}`)
    .get(orgId) as { n: number };
  const total = totalRow.n;

  const ageByLabel = new Map(ageRows.map((r) => [r.label, r.count]));
  const orderedAge: Array<{ label: string; count: number }> = [
    ...AGE_BANDS.map((b) => ({
      label: b.label,
      count: ageByLabel.get(b.label) ?? 0,
    })),
    { label: "Unknown", count: ageByLabel.get("Unknown") ?? 0 },
  ];

  const genderByLabel = new Map(genderRows.map((r) => [r.label, r.count]));
  const orderedGender = ["Male", "Female", "Unknown"].map((label) => ({
    label,
    count: genderByLabel.get(label) ?? 0,
  }));

  const kidsByLabel = new Map(kidsRows.map((r) => [r.label, r.count]));
  const orderedKids = ["Has kids", "No kids", "Unknown"].map((label) => ({
    label,
    count: kidsByLabel.get(label) ?? 0,
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
    hasKidsBuckets: orderedKids,
    totalWithBirthYear,
    totalWithGender,
  };
}
