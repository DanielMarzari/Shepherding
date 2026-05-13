import "server-only";
import { getDb } from "./db";

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
  /** Total attended people per month across all series — handy for
   *  rendering "% of cohort" if we want later. */
  totals: number[];
}

/** Build a 12-month time series of attendance (groups → distinct
 *  attendees per month; teams → distinct servers per month) broken
 *  down by a demographic dimension. */
export function getAttendanceTrend(
  orgId: number,
  scope: TrendScope,
  dimension: TrendDimension,
  months: number = 12,
): TrendSeries {
  const db = getDb();
  const now = new Date();
  const monthsList: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthsList.push(d.toISOString().slice(0, 7)); // YYYY-MM
  }
  const sinceIso =
    monthsList[0] && monthsList[0].length === 7
      ? `${monthsList[0]}-01T00:00:00Z`
      : new Date(now.getTime() - months * 30 * 24 * 60 * 60 * 1000).toISOString();

  const dimensionExpr = dimensionSql(dimension);
  const sql =
    scope === "groups"
      ? `
        SELECT
          substr(a.event_starts_at, 1, 7) AS month,
          ${dimensionExpr} AS dim,
          COUNT(DISTINCT a.person_id) AS n
        FROM pco_event_attendances a
        JOIN pco_people p
          ON p.org_id = a.org_id AND p.pco_id = a.person_id
        WHERE a.org_id = ?
          AND a.attended = 1
          AND a.event_starts_at IS NOT NULL
          AND a.event_starts_at >= ?
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
        JOIN pco_people p
          ON p.org_id = pp.org_id AND p.pco_id = pp.person_id
        WHERE pp.org_id = ?
          AND lower(coalesce(pp.status, 'c')) NOT IN ('d', 'declined')
          AND pl.sort_date IS NOT NULL
          AND pl.sort_date >= ?
        GROUP BY month, dim
        ORDER BY month ASC`;

  const rows = db.prepare(sql).all(orgId, sinceIso) as Array<{
    month: string;
    dim: string;
    n: number;
  }>;

  // Pivot rows into a per-label values[] array, indexed by month position.
  const monthIndex = new Map(monthsList.map((m, i) => [m, i]));
  const byLabel = new Map<string, number[]>();
  for (const r of rows) {
    if (!monthIndex.has(r.month)) continue;
    const idx = monthIndex.get(r.month)!;
    let series = byLabel.get(r.dim);
    if (!series) {
      series = new Array(monthsList.length).fill(0);
      byLabel.set(r.dim, series);
    }
    series[idx] = r.n;
  }

  // Canonical order per dimension; unknown last.
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
      // Inline age-band classifier mirroring lib/demographics.ts.
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
