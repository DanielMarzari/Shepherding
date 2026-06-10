import "server-only";
import { getDb } from "./db";
import { getSyncSettings } from "./pco";

// Work with 2016 (when the church started tracking in PCO) and forward;
// ignore anyone who joined before then. No pre-2016 pooled band.
const RETENTION_START_YEAR = 2016;
// The retention-% chart (byYear/byMonth) and seasonality start in 2017 —
// 2016 is the bulk PCO import, not a real join cohort, so its % is noise.
// The decay/stacked-area still includes the 2016 base as its starting band.
const PCT_START_YEAR = 2017;
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
  label: string;
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
  /** People who lapsed (>activity-window gap) then returned, by return year. */
  reactivations: Array<{ year: number; count: number }>;
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
  // Real-activity signals only — deliberately NOT last_pco_updated_at, which
  // PCO bumps on any profile edit/sync (the 2016 import stamped ~11k profiles
  // at once, making long-gone people look "active"). Survival uses the most
  // recent of these.
  lastForm: string | null;
  lastCheckin: string | null;
  lastAttended: string | null;
  lastServed: string | null;
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
              pa.last_form_at AS lastForm,
              pa.last_check_in_at AS lastCheckin,
              pa.last_attended_at AS lastAttended,
              pa.last_served_at AS lastServed,
              CASE WHEN pa.classification IS NOT NULL
                    AND pa.classification != 'inactive'
                   THEN 1 ELSE 0 END AS retained
         FROM pco_people p
         LEFT JOIN person_activity pa
           ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
        WHERE p.org_id = ?
          AND p.pco_created_at IS NOT NULL
          AND (p.is_minor IS NULL OR p.is_minor != 1)
          AND (p.membership_type IS NULL
               OR lower(p.membership_type) NOT LIKE '%system use%')`,
    )
    .all(orgId) as RawRow[];

  const yearAgg = new Map<string, { joined: number; retained: number }>();
  const monthAgg = new Map<string, { joined: number; retained: number }>();
  // Per join-year cohort member: id, currently-engaged flag, and the month of
  // their last activity. We add real per-month activity history below so we
  // can replay who was active as of each past period — including rejoin.
  const monthIdxOf = (iso: string) => Number(iso.slice(0, 4)) * 12 + (Number(iso.slice(5, 7)) - 1);
  const lastRealIdx = (r: RawRow): number => {
    let best = -Infinity;
    for (const d of [r.lastForm, r.lastCheckin, r.lastAttended, r.lastServed]) {
      if (d) best = Math.max(best, monthIdxOf(d));
    }
    return best;
  };
  // createdIdx = join month (so a cohort ramps as people actually join, not
  // appear full each January); lastIdx = last REAL activity month (survival).
  interface Member { createdIdx: number; lastIdx: number }
  const cohortMembers = new Map<number, Member[]>();
  for (const r of rows) {
    const y = Number(r.created.slice(0, 4));
    if (!y || y < RETENTION_START_YEAR) continue; // ignore anyone before the start year
    // retention-% chart / seasonality start in 2017 (skip the 2016 import).
    if (y >= PCT_START_YEAR) {
      bump(yearAgg, String(y), r.retained);
      bump(monthAgg, r.created.slice(0, 7), r.retained);
    }
    const arr = cohortMembers.get(y) ?? [];
    arr.push({ createdIdx: monthIdxOf(r.created), lastIdx: lastRealIdx(r) });
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

  // ── Decay: monotonic SURVIVAL of each cohort ────────────────────────
  // "Still retained as of T" = the person's most recent activity is within
  // the activity window ending at T (last activity hasn't aged out). This
  // can only fall as T advances, so a cohort never gains members in a later
  // year. Returns (someone who lapsed and came back) are tracked separately
  // below, not folded back into the decay line.
  const currentYear = new Date().getUTCFullYear();
  const currentMonth = new Date().getUTCMonth() + 1; // 1-indexed
  const win = activityMonths; // months in the activity window
  const survivedAt = (members: Member[], periodIdx: number): number => {
    const lo = periodIdx - win + 1;
    let c = 0;
    // Only count someone once they've actually joined (createdIdx <= P) AND
    // their last real activity hasn't aged out — so a cohort builds up as
    // people join through the year, then decays, instead of starting full.
    for (const m of members) if (m.createdIdx <= periodIdx && m.lastIdx >= lo) c++;
    return c;
  };

  const decay: CohortDecay[] = [...cohortMembers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, members]) => {
      const size = members.length;
      const pct = (count: number) => (size > 0 ? Math.round((count / size) * 100) : 0);
      const points: Array<{ year: number; pct: number; count: number }> = [];
      for (let Y = year; Y <= currentYear; Y++) {
        const count = survivedAt(members, Y * 12 + 11);
        points.push({ year: Y, count, pct: pct(count) });
      }
      const monthly: Array<{ key: string; pct: number; count: number }> = [];
      for (let yy = year; yy <= currentYear; yy++) {
        const endMo = yy === currentYear ? currentMonth : 12;
        for (let mm = 1; mm <= endMo; mm++) {
          const count = survivedAt(members, yy * 12 + (mm - 1));
          monthly.push({ key: `${yy}-${String(mm).padStart(2, "0")}`, count, pct: pct(count) });
        }
      }
      return { year, label: String(year), size, currentPct: points[points.length - 1]?.pct ?? 0, points, monthly };
    });

  // ── Reactivations (lapsed → returned): DISABLED on the page-load path.
  //    It requires scanning ~330k dated activity rows (266k check-ins +
  //    61k plan rows), which takes minutes on the 1 GB box and was 502-ing
  //    /retention. It belongs in a nightly precompute, not a live request.
  const reactivations: Array<{ year: number; count: number }> = [];

  const realCohorts = decay;

  // Annual decay rate = avg fraction of still-retained members lost per year
  // (across cohorts, year over year, while retention is still > 0).
  const ratios: number[] = [];
  for (const c of realCohorts) {
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
  const yr1 = realCohorts.map((c) => c.points[1]?.pct).filter((v): v is number => v != null);
  if (yr1.length) {
    const avg = Math.round(yr1.reduce((a, b) => a + b, 0) / yr1.length);
    decayTrends.push({
      title: `~${avg}% after year one`,
      detail: "On average, a cohort is down to about this share still active a year after joining.",
      tone: avg < 50 ? "down" : "neutral",
    });
  }
  const oldest = realCohorts[0];
  if (oldest) {
    const last = oldest.points[oldest.points.length - 1];
    decayTrends.push({
      title: `${oldest.year} cohort: ${oldest.currentPct}%`,
      detail: `${last.count.toLocaleString()} of ${oldest.size.toLocaleString()} still engaged ${currentYear - oldest.year} years on.`,
      tone: "neutral",
    });
  }
  const survivingNow = decay.reduce((a, c) => a + (c.points[c.points.length - 1]?.count ?? 0), 0);
  if (survivingNow > 0) {
    decayTrends.push({
      title: `~${survivingNow.toLocaleString()} still retained`,
      detail: "Adults across all join cohorts whose most recent activity is still within the activity window.",
      tone: "up",
    });
  }
  const reactNow = reactivations[reactivations.length - 1];
  if (reactNow) {
    decayTrends.push({
      title: `${reactNow.count.toLocaleString()} returned in ${reactNow.year}`,
      detail: "Lapsed (a gap longer than the activity window) and then came back — tracked separately from the decay.",
      tone: "neutral",
    });
  }
  // COVID trend: compare the engaged base just before COVID (end of 2019) to
  // its low after lockdowns and to today — name the shift.
  const totalAtYear = (Y: number) => decay.reduce((a, c) => a + (c.points.find((p) => p.year === Y)?.count ?? 0), 0);
  const pre = totalAtYear(2019);
  const trough = Math.min(totalAtYear(2020), totalAtYear(2021));
  const nowTotal = totalAtYear(currentYear);
  if (pre > 0 && trough > 0) {
    const dropPct = Math.round((1 - trough / pre) * 100);
    const recoveredPct = Math.round((nowTotal / pre) * 100);
    decayTrends.push({
      title: dropPct >= 15 ? `COVID cliff: −${dropPct}% by 2020–21` : `Steady through COVID`,
      detail:
        recoveredPct >= 95
          ? `Recorded activity fell ${dropPct}% from its 2019 level during the 2020–21 shutdowns, but has since recovered to ~${recoveredPct}% of pre-COVID.`
          : `Recorded activity fell ${dropPct}% from 2019 during the 2020–21 shutdowns and sits at ~${recoveredPct}% of the pre-COVID level today — a lasting step down, not a full rebound.`,
      tone: recoveredPct >= 95 ? "up" : "down",
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
    reactivations,
    seasonality,
    bestMonth,
    worstMonth,
    seasonalityTrends,
    overallJoined,
    overallRetained,
    activityMonths,
    startYear: PCT_START_YEAR,
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
