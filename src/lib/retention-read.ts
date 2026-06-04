import "server-only";
import { getDb } from "./db";
import { getSyncSettings } from "./pco";

// Our big PCO import was 2016 (≈12k people, ~1.1k real), so treat
// everything before this as transition noise, not live data.
const RETENTION_START_YEAR = 2017;
const MS_PER_MONTH = 30.4375 * 86_400_000;

export interface MonthCell {
  month: number; // 1-12
  joined: number;
  retained: number;
  pct: number;
  pending: boolean;
  hasData: boolean;
}
export interface RetentionYear {
  year: number;
  joined: number;
  retained: number;
  pct: number;
  /** Whole year still inside the activity window → not yet measurable. */
  pending: boolean;
  /** Always 12 cells (Jan..Dec); cells with no joins have hasData=false. */
  months: MonthCell[];
}
export interface RetentionSummary {
  years: RetentionYear[];
  /** Settled cohorts only (excludes pending years). */
  overallJoined: number;
  overallRetained: number;
  activityMonths: number;
  startYear: number;
}

interface RawRow {
  created: string;
  retained: number;
}

/** Retention by join-cohort, grouped by year with each year's 12 monthly
 *  sub-cohorts. A cohort is "pending" until the activity window has
 *  elapsed past the end of the period — before then everyone still reads
 *  as active by recency, so the % would be a meaningless ~100%. */
export function getRetention(orgId: number): RetentionSummary {
  const activityMonths = getSyncSettings(orgId).activityMonths;
  const rows = getDb()
    .prepare(
      `SELECT p.pco_created_at AS created,
              CASE WHEN pa.classification IS NOT NULL
                    AND pa.classification != 'inactive'
                   THEN 1 ELSE 0 END AS retained
         FROM pco_people p
         LEFT JOIN person_activity pa
           ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
        WHERE p.org_id = ?
          AND p.pco_created_at IS NOT NULL
          AND (p.membership_type IS NULL
               OR lower(p.membership_type) NOT LIKE '%system use%')`,
    )
    .all(orgId) as RawRow[];

  // Aggregate joined/retained per (year) and per (year, month).
  const yearAgg = new Map<number, { joined: number; retained: number }>();
  const monthAgg = new Map<string, { joined: number; retained: number }>();
  for (const r of rows) {
    const y = Number(r.created.slice(0, 4));
    if (!y || y < RETENTION_START_YEAR) continue;
    const mo = Number(r.created.slice(5, 7));
    if (!mo) continue;
    bump(yearAgg, y, r.retained);
    bumpStr(monthAgg, `${y}-${mo}`, r.retained);
  }

  const now = Date.now();
  const yearPending = (y: number) =>
    (now - Date.UTC(y + 1, 0, 1)) / MS_PER_MONTH < activityMonths;
  const monthPending = (y: number, mo: number) =>
    (now - Date.UTC(y, mo, 1)) / MS_PER_MONTH < activityMonths;

  const years: RetentionYear[] = [...yearAgg.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, v]) => {
      const months: MonthCell[] = [];
      for (let mo = 1; mo <= 12; mo++) {
        const m = monthAgg.get(`${y}-${mo}`);
        months.push({
          month: mo,
          joined: m?.joined ?? 0,
          retained: m?.retained ?? 0,
          pct: m && m.joined > 0 ? Math.round((m.retained / m.joined) * 100) : 0,
          pending: monthPending(y, mo),
          hasData: !!m && m.joined > 0,
        });
      }
      return {
        year: y,
        joined: v.joined,
        retained: v.retained,
        pct: v.joined > 0 ? Math.round((v.retained / v.joined) * 100) : 0,
        pending: yearPending(y),
        months,
      };
    });

  let overallJoined = 0;
  let overallRetained = 0;
  for (const yr of years) {
    if (yr.pending) continue;
    overallJoined += yr.joined;
    overallRetained += yr.retained;
  }

  return {
    years,
    overallJoined,
    overallRetained,
    activityMonths,
    startYear: RETENTION_START_YEAR,
  };
}

function bump(
  m: Map<number, { joined: number; retained: number }>,
  key: number,
  retained: number,
) {
  const e = m.get(key) ?? { joined: 0, retained: 0 };
  e.joined += 1;
  e.retained += retained;
  m.set(key, e);
}
function bumpStr(
  m: Map<string, { joined: number; retained: number }>,
  key: string,
  retained: number,
) {
  const e = m.get(key) ?? { joined: 0, retained: 0 };
  e.joined += 1;
  e.retained += retained;
  m.set(key, e);
}
