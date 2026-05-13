import "server-only";
import { getDb } from "./db";
import {
  type DemographicScope,
  populatePeopleInScope,
} from "./demographics";

export type TrendScope = "groups" | "teams";
export type TrendDimension = "gender" | "ageBand" | "hasKids";

export interface TrendSeries {
  /** ISO YYYY-MM strings, oldest first. */
  months: string[];
  /** Per-dimension-value series of attendance counts per month. */
  series: Array<{
    label: string;
    values: number[];
  }>;
  /** Total attended people per month across all series. */
  totals: number[];
}

/** 12-month time series of attendance (groups → distinct attendees per
 *  month; teams → distinct servers per month) broken by a demographic
 *  dimension. The `filterScope` lets the caller narrow the underlying
 *  attendance / serving rows to a specific group / team / type. */
export function getAttendanceTrend(
  orgId: number,
  trendScope: TrendScope,
  dimension: TrendDimension,
  filterScope: DemographicScope,
  months = 12,
): TrendSeries {
  const db = getDb();
  populatePeopleInScope(orgId, filterScope);

  const monthsList = buildMonthsList(months);
  const sinceIso = `${monthsList[0]}-01T00:00:00Z`;
  const dimensionExpr = dimensionSql(dimension);

  // Rows are restricted both by:
  //   (a) the demographic scope filter (temp.people_scope) and
  //   (b) for "group"/"team" filters, the matching group/team id.
  const groupIdFilter =
    filterScope.kind === "group"
      ? ` AND a.group_id = ${escapeId(filterScope.id)}`
      : filterScope.kind === "groupType"
        ? ` AND EXISTS (
              SELECT 1 FROM pco_groups gg
              WHERE gg.org_id = a.org_id
                AND gg.pco_id = a.group_id
                AND coalesce(gg.group_type_id, '') = ${escapeId(filterScope.id)}
            )`
        : "";
  const teamIdFilter =
    filterScope.kind === "team"
      ? ` AND pp.team_id = ${escapeId(filterScope.id)}`
      : filterScope.kind === "serviceType"
        ? ` AND EXISTS (
              SELECT 1 FROM pco_teams tt
              WHERE tt.org_id = pp.org_id
                AND tt.pco_id = pp.team_id
                AND coalesce(tt.service_type_id, '') = ${escapeId(filterScope.id)}
            )`
        : "";

  const sql =
    trendScope === "groups"
      ? `
        SELECT
          substr(a.event_starts_at, 1, 7) AS month,
          ${dimensionExpr} AS dim,
          COUNT(DISTINCT a.person_id) AS n
        FROM pco_event_attendances a
        JOIN temp.people_scope s ON s.person_id = a.person_id
        JOIN pco_people p
          ON p.org_id = a.org_id AND p.pco_id = a.person_id
        WHERE a.org_id = ?
          AND a.attended = 1
          AND a.event_starts_at IS NOT NULL
          AND a.event_starts_at >= ?${groupIdFilter}
        GROUP BY month, dim
        ORDER BY month ASC`
      : `
        SELECT
          substr(pl.sort_date, 1, 7) AS month,
          ${dimensionExpr} AS dim,
          COUNT(DISTINCT pp.person_id) AS n
        FROM pco_plan_people pp
        JOIN pco_plans pl
          ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
        JOIN temp.people_scope s ON s.person_id = pp.person_id
        JOIN pco_people p
          ON p.org_id = pp.org_id AND p.pco_id = pp.person_id
        WHERE pp.org_id = ?
          AND lower(coalesce(pp.status, 'c')) NOT IN ('d', 'declined')
          AND pl.sort_date IS NOT NULL
          AND pl.sort_date >= ?${teamIdFilter}
        GROUP BY month, dim
        ORDER BY month ASC`;

  const rows = db.prepare(sql).all(orgId, sinceIso) as Array<{
    month: string;
    dim: string;
    n: number;
  }>;

  const monthIndex = new Map(monthsList.map((m, i) => [m, i]));
  const byLabel = new Map<string, number[]>();
  for (const r of rows) {
    if (!monthIndex.has(r.month)) continue;
    const idx = monthIndex.get(r.month)!;
    let arr = byLabel.get(r.dim);
    if (!arr) {
      arr = new Array(monthsList.length).fill(0);
      byLabel.set(r.dim, arr);
    }
    arr[idx] = r.n;
  }

  const canonical = canonicalOrder(dimension);
  const seenLabels = new Set(byLabel.keys());
  const orderedLabels = [
    ...canonical.filter((l) => seenLabels.has(l)),
    ...Array.from(seenLabels).filter((l) => !canonical.includes(l)),
  ];

  const series = orderedLabels.map((label) => ({
    label,
    values: byLabel.get(label) ?? new Array(monthsList.length).fill(0),
  }));
  const totals = new Array(monthsList.length).fill(0);
  for (const s of series) {
    for (let i = 0; i < monthsList.length; i++) totals[i] += s.values[i];
  }
  return { months: monthsList, series, totals };
}

function buildMonthsList(months: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Naive SQL-string escape for the id values we pass into trend filters.
 *  All callers supply ids from internal navigation, never user input, so
 *  this just defends against quotes if PCO ever returns one. */
function escapeId(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

function dimensionSql(dimension: TrendDimension): string {
  switch (dimension) {
    case "gender":
      return `CASE
        WHEN lower(coalesce(p.gender, '')) IN ('m', 'male') THEN 'Male'
        WHEN lower(coalesce(p.gender, '')) IN ('f', 'female') THEN 'Female'
        ELSE 'Unknown'
      END`;
    case "hasKids":
      return `CASE
        WHEN p.is_minor = 1 THEN 'Minor'
        WHEN p.is_parent = 1 THEN 'Has kids'
        WHEN p.birth_year IS NOT NULL THEN 'No kids'
        ELSE 'Unknown'
      END`;
    case "ageBand": {
      const thisYear = new Date().getUTCFullYear();
      return `CASE
        WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 'Unknown'
        WHEN (${thisYear} - p.birth_year) <= 5 THEN '0–5'
        WHEN (${thisYear} - p.birth_year) <= 12 THEN '6–12'
        WHEN (${thisYear} - p.birth_year) <= 17 THEN '13–17'
        WHEN (${thisYear} - p.birth_year) <= 25 THEN '18–25'
        WHEN (${thisYear} - p.birth_year) <= 35 THEN '26–35'
        WHEN (${thisYear} - p.birth_year) <= 50 THEN '36–50'
        WHEN (${thisYear} - p.birth_year) <= 65 THEN '51–65'
        ELSE '66+'
      END`;
    }
  }
}

function canonicalOrder(dimension: TrendDimension): string[] {
  switch (dimension) {
    case "gender":
      return ["Male", "Female", "Unknown"];
    case "hasKids":
      return ["Has kids", "No kids", "Minor", "Unknown"];
    case "ageBand":
      return [
        "0–5",
        "6–12",
        "13–17",
        "18–25",
        "26–35",
        "36–50",
        "51–65",
        "66+",
        "Unknown",
      ];
  }
}
