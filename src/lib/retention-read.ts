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
export interface RetentionInsight {
  title: string;
  detail: string;
  tone: "up" | "down" | "neutral";
}
/** One join-year cohort's retention measured as-of each later year-end. */
export interface CohortDecay {
  year: number;
  size: number;
  currentPct: number;
  points: Array<{ year: number; pct: number; count: number }>;
  /** Finer monthly resolution of the same active-as-of measure. */
  monthly: Array<{ key: string; pct: number; count: number }>;
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
  /** Auto-generated insights for the decay chart. */
  decayTrends: RetentionInsight[];
  /** Retention by calendar month-of-year + the best/worst months. */
  seasonality: MonthSeasonality[];
  bestMonth: MonthSeasonality | null;
  worstMonth: MonthSeasonality | null;
  /** Auto-generated insights for the seasonality chart. */
  seasonalityTrends: RetentionInsight[];
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
  lastActivity: string | null;
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
              pa.last_activity_at AS lastActivity,
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
  // Per join-year cohort: each member's last-activity timestamp (or NaN) and
  // whether they're currently engaged (classification != inactive), so we can
  // replay who was still active as of each past year-end and anchor the
  // current point to the live engaged count.
  const cohortMembers = new Map<number, Array<{ last: number; retained: number }>>();
  for (const r of rows) {
    const y = Number(r.created.slice(0, 4));
    if (!y || y < RETENTION_START_YEAR) continue;
    bump(yearAgg, String(y), r.retained);
    bump(monthAgg, r.created.slice(0, 7), r.retained);
    const arr = cohortMembers.get(y) ?? [];
    arr.push({ last: r.lastActivity ? Date.parse(r.lastActivity) : NaN, retained: r.retained });
    cohortMembers.set(y, arr);
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

  const currentMonth = new Date().getUTCMonth() + 1; // 1-indexed
  // Active as of time T = last recorded activity within the window ending at
  // T. For the CURRENT period we use the live classification (engaged =
  // not-inactive) so the latest number matches the dashboard / PCO exactly —
  // it also credits group/team membership, which a date alone can't.
  const decay: CohortDecay[] = [...cohortMembers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, members]) => {
      const size = members.length;
      const pct = (count: number) => (size > 0 ? Math.round((count / size) * 100) : 0);
      const countAsOf = (ref: number, isCurrent: boolean): number => {
        if (isCurrent) {
          let c = 0;
          for (const m of members) if (m.retained) c++;
          return c;
        }
        const lo = ref - winMs;
        let c = 0;
        for (const m of members) if (!Number.isNaN(m.last) && m.last >= lo && m.last <= ref) c++;
        return c;
      };
      // Yearly: active as of each year-end (live engaged for the current year).
      const points: Array<{ year: number; pct: number; count: number }> = [];
      for (let Y = year; Y <= currentYear; Y++) {
        const isCur = Y === currentYear;
        const count = countAsOf(isCur ? now : Date.UTC(Y + 1, 0, 1), isCur);
        points.push({ year: Y, count, pct: pct(count) });
      }
      // Monthly: finer resolution of the same measure.
      const monthly: Array<{ key: string; pct: number; count: number }> = [];
      for (let yy = year; yy <= currentYear; yy++) {
        const endMo = yy === currentYear ? currentMonth : 12;
        for (let mm = 1; mm <= endMo; mm++) {
          const isCur = yy === currentYear && mm === currentMonth;
          const count = countAsOf(isCur ? now : Date.UTC(yy, mm, 1), isCur);
          monthly.push({ key: `${yy}-${String(mm).padStart(2, "0")}`, count, pct: pct(count) });
        }
      }
      return { year, size, currentPct: points[points.length - 1]?.pct ?? 0, points, monthly };
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

  // ── Trends / auto-insights (cards) ───────────────────────────────────
  const decayTrends: RetentionInsight[] = [];
  if (annualDecayPct != null) {
    decayTrends.push({
      title: `~${annualDecayPct}% lost per year`,
      detail: "Average share of a cohort's still-active members who fall away each year — the decay rate.",
      tone: annualDecayPct >= 20 ? "down" : "neutral",
    });
  }
  const yr1 = decay.map((c) => c.points[1]?.pct).filter((v): v is number => v != null);
  if (yr1.length) {
    const avg = Math.round(yr1.reduce((a, b) => a + b, 0) / yr1.length);
    decayTrends.push({
      title: `~${avg}% after year one`,
      detail: "On average, a cohort is down to about this share still active a year after joining.",
      tone: avg < 50 ? "down" : "neutral",
    });
  }
  const oldest = decay[0];
  if (oldest) {
    const last = oldest.points[oldest.points.length - 1];
    decayTrends.push({
      title: `${oldest.year} cohort: ${oldest.currentPct}%`,
      detail: `${last.count.toLocaleString()} of ${oldest.size.toLocaleString()} still engaged ${currentYear - oldest.year} years on.`,
      tone: "neutral",
    });
  }
  const engagedNow = decay.reduce((a, c) => a + (c.points[c.points.length - 1]?.count ?? 0), 0);
  if (engagedNow > 0) {
    decayTrends.push({
      title: `~${engagedNow.toLocaleString()} engaged today`,
      detail: "Across all tracked join-year cohorts, still active right now.",
      tone: "up",
    });
  }

  const seasonalityTrends: RetentionInsight[] = [];
  if (bestMonth && worstMonth && bestMonth.month !== worstMonth.month) {
    seasonalityTrends.push({
      title: `${bestMonth.label} sticks best (${bestMonth.pct}%)`,
      detail: `${worstMonth.label} joiners retain worst (${worstMonth.pct}%) — a ${bestMonth.pct - worstMonth.pct}-point spread by join month.`,
      tone: "up",
    });
  }
  const SEASONS: Array<[string, number[]]> = [
    ["Winter", [12, 1, 2]], ["Spring", [3, 4, 5]], ["Summer", [6, 7, 8]], ["Fall", [9, 10, 11]],
  ];
  const seasonPct = SEASONS.map(([name, mos]) => {
    let j = 0, r = 0;
    for (const s of seasonality) if (mos.includes(s.month)) { j += s.joined; r += s.retained; }
    return { name, joined: j, pct: j > 0 ? Math.round((r / j) * 100) : 0 };
  }).filter((s) => s.joined >= 30).sort((a, b) => b.pct - a.pct);
  if (seasonPct.length >= 2) {
    const b = seasonPct[0], w = seasonPct[seasonPct.length - 1];
    seasonalityTrends.push({
      title: `${b.name} > ${w.name}`,
      detail: `By season, ${b.name} brings the stickiest newcomers (${b.pct}%) and ${w.name} the least (${w.pct}%).`,
      tone: "neutral",
    });
  }

  return {
    byYear,
    byMonth,
    decay,
    annualDecayPct,
    decayTrends,
    seasonality,
    bestMonth,
    worstMonth,
    seasonalityTrends,
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
