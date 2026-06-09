import "server-only";
import { getDb } from "./db";
import { getSyncSettings } from "./pco";

// Our big PCO import was 2016 (≈12k people, ~1.1k real), so treat
// everything before this as transition noise, not live data.
const RETENTION_START_YEAR = 2017;
const MS_PER_MONTH = 30.4375 * 86_400_000;

export interface RetentionPoint {
  /** "2021" for yearly, "2021-03" for monthly. */
  key: string;
  label: string;
  joined: number;
  retained: number;
  pct: number;
  /** Inside the activity window → not yet measurable ("ongoing"). */
  pending: boolean;
}
/** One join-year cohort's retention measured as-of each later year-end. */
export interface CohortDecay {
  year: number;
  size: number;
  currentPct: number;
  points: Array<{ year: number; pct: number; count: number }>;
}
/** Retention by calendar month-of-year (settled monthly cohorts pooled). */
export interface MonthSeasonality {
  month: number; // 1–12
  label: string;
  cohorts: number;
  joined: number;
  retained: number;
  pct: number;
}
export interface RetentionSummary {
  byYear: RetentionPoint[];
  byMonth: RetentionPoint[];
  /** Per-cohort decay (how each join-year's retention fell year by year). */
  decay: CohortDecay[];
  /** Avg % of still-retained members lost each year (the decay rate). */
  annualDecayPct: number | null;
  /** Retention by calendar month-of-year + the best/worst months. */
  seasonality: MonthSeasonality[];
  bestMonth: MonthSeasonality | null;
  worstMonth: MonthSeasonality | null;
  /** Settled cohorts only (excludes pending). */
  overallJoined: number;
  overallRetained: number;
  activityMonths: number;
  startYear: number;
}

interface RawRow {
  personId: string;
  created: string;
  retained: number;
}

/** Retention by join-cohort (yearly + monthly series for a line chart).
 *  A cohort is "pending" until the activity window has elapsed past the
 *  end of the period — before then everyone still reads as active by
 *  recency, so the % would be a meaningless ~100%. */
export function getRetention(orgId: number): RetentionSummary {
  const activityMonths = getSyncSettings(orgId).activityMonths;
  const rows = getDb()
    .prepare(
      `SELECT p.pco_id AS personId,
              p.pco_created_at AS created,
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
  // Per join-year cohort: the member ids, so we can replay each person's
  // real activity history (group attendance / check-ins / serving) and see
  // who was active as of each year — including leave-then-rejoin.
  const cohortMembers = new Map<number, string[]>();
  const memberYear = new Map<string, number>();
  for (const r of rows) {
    const y = Number(r.created.slice(0, 4));
    if (!y || y < RETENTION_START_YEAR) continue;
    bump(yearAgg, String(y), r.retained);
    bump(monthAgg, r.created.slice(0, 7), r.retained);
    const arr = cohortMembers.get(y) ?? [];
    arr.push(r.personId);
    cohortMembers.set(y, arr);
    memberYear.set(r.personId, y);
  }

  const now = Date.now();
  const yearPending = (key: string) =>
    (now - Date.UTC(Number(key) + 1, 0, 1)) / MS_PER_MONTH < activityMonths;
  const monthPending = (key: string) => {
    const yr = Number(key.slice(0, 4));
    const mo = Number(key.slice(5, 7)); // 1-indexed → next-month start
    return (now - Date.UTC(yr, mo, 1)) / MS_PER_MONTH < activityMonths;
  };

  const byYear = toPoints(yearAgg, (k) => k, yearPending);
  const byMonth = toPoints(monthAgg, monthLabel, monthPending);

  let overallJoined = 0;
  let overallRetained = 0;
  for (const c of byYear) {
    if (c.pending) continue;
    overallJoined += c.joined;
    overallRetained += c.retained;
  }

  // ── Decay: replay each person's recorded activity to see who was active
  //    as of each later year-end (handles leave → rejoin). ──────────────
  const winMs = activityMonths * MS_PER_MONTH;
  const currentYear = new Date().getUTCFullYear();

  // Dated activity events (group attendance, check-ins, serving) since just
  // before the start year, for cohort members only.
  const cutoffIso = `${RETENTION_START_YEAR - 1}`;
  const evRows = getDb()
    .prepare(
      `SELECT person_id AS pid, event_starts_at AS d
         FROM pco_event_attendances
        WHERE org_id = ? AND attended = 1 AND event_starts_at >= ?
       UNION ALL
       SELECT person_id AS pid, event_time_at AS d
         FROM pco_check_ins
        WHERE org_id = ? AND person_id IS NOT NULL AND event_time_at >= ?
       UNION ALL
       SELECT pp.person_id AS pid, pl.sort_date AS d
         FROM pco_plan_people pp
         JOIN pco_plans pl ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
        WHERE pp.org_id = ? AND pl.sort_date >= ?`,
    )
    .all(orgId, cutoffIso, orgId, cutoffIso, orgId, cutoffIso) as Array<{ pid: string; d: string }>;

  const acts = new Map<string, number[]>();
  for (const e of evRows) {
    if (!memberYear.has(e.pid)) continue;
    const ms = Date.parse(e.d);
    if (Number.isNaN(ms)) continue;
    const arr = acts.get(e.pid);
    if (arr) arr.push(ms);
    else acts.set(e.pid, [ms]);
  }
  for (const arr of acts.values()) arr.sort((a, b) => a - b);

  // True if a sorted ms array has any entry in (lo, hi].
  const activeInWindow = (arr: number[] | undefined, lo: number, hi: number): boolean => {
    if (!arr || arr.length === 0) return false;
    let l = 0, r = arr.length - 1, idx = arr.length;
    while (l <= r) {
      const m = (l + r) >> 1;
      if (arr[m] >= lo) { idx = m; r = m - 1; } else l = m + 1;
    }
    return idx < arr.length && arr[idx] <= hi;
  };

  const decay: CohortDecay[] = [...cohortMembers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, members]) => {
      const size = members.length;
      const points: Array<{ year: number; pct: number; count: number }> = [];
      for (let Y = year; Y <= currentYear; Y++) {
        const ref = Y < currentYear ? Date.UTC(Y + 1, 0, 1) : now;
        const lo = ref - winMs;
        let count = 0;
        for (const pid of members) if (activeInWindow(acts.get(pid), lo, ref)) count++;
        points.push({ year: Y, count, pct: size > 0 ? Math.round((count / size) * 100) : 0 });
      }
      return { year, size, currentPct: points[points.length - 1]?.pct ?? 0, points };
    });

  // Annual decay rate = avg fraction of still-retained members lost per year
  // (across cohorts, year over year, while retention is still > 0).
  const ratios: number[] = [];
  for (const c of decay) {
    for (let k = 1; k < c.points.length; k++) {
      const prev = c.points[k - 1].pct;
      if (prev > 0) ratios.push(c.points[k].pct / prev);
    }
  }
  const annualDecayPct = ratios.length
    ? Math.round((1 - ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100)
    : null;

  // ── Seasonality: pool settled monthly cohorts by calendar month ──────
  const monAgg = new Map<number, { joined: number; retained: number; cohorts: number }>();
  for (const m of byMonth) {
    if (m.pending) continue;
    const mo = Number(m.key.slice(5, 7));
    const e = monAgg.get(mo) ?? { joined: 0, retained: 0, cohorts: 0 };
    e.joined += m.joined;
    e.retained += m.retained;
    e.cohorts += 1;
    monAgg.set(mo, e);
  }
  const seasonality: MonthSeasonality[] = [];
  for (let mo = 1; mo <= 12; mo++) {
    const e = monAgg.get(mo);
    seasonality.push({
      month: mo,
      label: MONTHS[mo - 1],
      cohorts: e?.cohorts ?? 0,
      joined: e?.joined ?? 0,
      retained: e?.retained ?? 0,
      pct: e && e.joined > 0 ? Math.round((e.retained / e.joined) * 100) : 0,
    });
  }
  const ranked = seasonality.filter((s) => s.joined >= 20).sort((a, b) => b.pct - a.pct);
  const bestMonth = ranked[0] ?? null;
  const worstMonth = ranked.length ? ranked[ranked.length - 1] : null;

  return {
    byYear,
    byMonth,
    decay,
    annualDecayPct,
    seasonality,
    bestMonth,
    worstMonth,
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

function toPoints(
  agg: Map<string, { joined: number; retained: number }>,
  label: (key: string) => string,
  pending: (key: string) => boolean,
): RetentionPoint[] {
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
