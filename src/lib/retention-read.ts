import "server-only";
import { getDb } from "./db";
import { getSyncSettings } from "./pco";

// Our big PCO import was 2016 (≈12k people, ~1.1k real), so treat
// everything before this as transition noise, not live data.
const RETENTION_START_YEAR = 2017;
const MS_PER_MONTH = 30.4375 * 86_400_000;

export interface RetentionCohort {
  /** "2021" for yearly, "2021-03" for monthly. */
  key: string;
  label: string;
  joined: number;
  /** Of those, how many are still active today. */
  retained: number;
  pct: number;
  /** True when the cohort is still inside the activity window, so its
   *  retention can't be measured yet (everyone still counts as active by
   *  recency). Shown as "ongoing", not a real %. */
  pending: boolean;
}
export interface RetentionSummary {
  byYear: RetentionCohort[];
  byMonth: RetentionCohort[];
  /** Settled cohorts only (excludes pending). */
  overallJoined: number;
  overallRetained: number;
  activityMonths: number;
  startYear: number;
}

interface RawRow {
  created: string;
  retained: number;
}

/** Retention by join-cohort. A cohort is "pending" until the activity
 *  window has fully elapsed past the end of the period — before then
 *  everyone still reads as active simply because they joined recently,
 *  so the % would be a meaningless ~100%. */
export function getRetentionCohorts(orgId: number): RetentionSummary {
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

  const yearAgg = new Map<string, { joined: number; retained: number }>();
  const monthAgg = new Map<string, { joined: number; retained: number }>();
  for (const r of rows) {
    const y = Number(r.created.slice(0, 4));
    if (!y || y < RETENTION_START_YEAR) continue;
    const ym = r.created.slice(0, 7);
    bump(yearAgg, String(y), r.retained);
    bump(monthAgg, ym, r.retained);
  }

  const now = Date.now();
  const yearEndPending = (key: string) => {
    const end = Date.UTC(Number(key) + 1, 0, 1); // start of next year
    return (now - end) / MS_PER_MONTH < activityMonths;
  };
  const monthEndPending = (key: string) => {
    const yr = Number(key.slice(0, 4));
    const mo = Number(key.slice(5, 7)); // 1-indexed → next-month start
    const end = Date.UTC(yr, mo, 1);
    return (now - end) / MS_PER_MONTH < activityMonths;
  };

  const byYear = toCohorts(yearAgg, (k) => k, yearEndPending);
  const byMonth = toCohorts(monthAgg, monthLabel, monthEndPending);

  let overallJoined = 0;
  let overallRetained = 0;
  for (const c of byYear) {
    if (c.pending) continue;
    overallJoined += c.joined;
    overallRetained += c.retained;
  }

  return {
    byYear,
    byMonth,
    overallJoined,
    overallRetained,
    activityMonths,
    startYear: RETENTION_START_YEAR,
  };
}

function bump(
  m: Map<string, { joined: number; retained: number }>,
  key: string,
  retained: number,
) {
  const e = m.get(key) ?? { joined: 0, retained: 0 };
  e.joined += 1;
  e.retained += retained;
  m.set(key, e);
}

function toCohorts(
  agg: Map<string, { joined: number; retained: number }>,
  label: (key: string) => string,
  pending: (key: string) => boolean,
): RetentionCohort[] {
  return [...agg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({
      key,
      label: label(key),
      joined: v.joined,
      retained: v.retained,
      pct: v.joined > 0 ? Math.round((v.retained / v.joined) * 100) : 0,
      pending: pending(key),
    }));
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monthLabel(key: string): string {
  const mo = Number(key.slice(5, 7));
  return `${MONTHS[mo - 1] ?? key.slice(5, 7)} ${key.slice(0, 4)}`;
}
