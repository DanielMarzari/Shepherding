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
  /** Retention decay — per first-engagement cohort (shepherded OR active). */
  decay: CohortDecay[];
  /** Interaction decay — per join cohort, surviving by last real interaction
   *  (includes everyone who joined, even those who went inactive). */
  interactionDecay: CohortDecay[];
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
  // Last ANY PCO touch — most recent of activity OR a profile create/update
  // (i.e. last_activity_at, which includes pco_updated_at). Powers the
  // "Interaction decay": every record counts from its join until this signal
  // ages out of the window — including "present" people whose only touch is a
  // profile edit, and people who created a record once and then vanished.
  lastActivity: string | null;
  // First/last ACTIVITY month-index (year*12 + month-1) from the nightly
  // precompute (retention_engagement): dated check-ins, plan serving, event
  // attendance. Combined with live group/team membership spans to define
  // "engaged" (shepherded OR active) for the Retention decay.
  firstMi: number | null;
  lastMi: number | null;
}

/** Retention by join-cohort (yearly + monthly series for a line chart).
 *  A cohort is "pending" until the activity window has elapsed past the
 *  end of the period — before then everyone still reads as active by
 *  recency, so the % would be a meaningless ~100%. */
export function getRetention(orgId: number): RetentionSummary {
  const activityMonths = getSyncSettings(orgId).activityMonths;
  const currentYear = new Date().getUTCFullYear();
  const rows = getDb()
    .prepare(
      `SELECT p.pco_id AS personId,
              p.pco_created_at AS created,
              pa.last_activity_at AS lastActivity,
              re.first_mi AS firstMi,
              re.last_mi AS lastMi,
              CASE WHEN pa.classification IS NOT NULL
                    AND pa.classification != 'inactive'
                   THEN 1 ELSE 0 END AS retained
         FROM pco_people p
         LEFT JOIN person_activity pa
           ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
         LEFT JOIN retention_engagement re
           ON re.org_id = p.org_id AND re.person_id = p.pco_id
        WHERE p.org_id = ?
          AND p.pco_created_at IS NOT NULL
          AND (p.is_minor IS NULL OR p.is_minor != 1)
          AND (p.membership_type IS NULL
               OR lower(p.membership_type) NOT LIKE '%system use%')`,
    )
    .all(orgId) as RawRow[];

  const win = activityMonths; // months in the activity window
  const currentMi = currentYear * 12 + new Date().getUTCMonth(); // this month

  // "Shepherded" spans, computed live (these tables are tiny): the months a
  // person held a group/team membership. Still-open memberships (no archive)
  // run to this month. MIN start / MAX end per person.
  const memRows = getDb()
    .prepare(
      `SELECT pid, MIN(smi) AS mfirst, MAX(emi) AS mlast FROM (
         SELECT person_id AS pid,
                CAST(substr(joined_at,1,4) AS INTEGER)*12 + CAST(substr(joined_at,6,2) AS INTEGER) - 1 AS smi,
                CASE WHEN archived_at IS NULL THEN ?
                     ELSE CAST(substr(archived_at,1,4) AS INTEGER)*12 + CAST(substr(archived_at,6,2) AS INTEGER) - 1 END AS emi
           FROM pco_group_memberships WHERE org_id = ? AND joined_at IS NOT NULL
         UNION ALL
         SELECT person_id AS pid,
                CAST(substr(pco_created_at,1,4) AS INTEGER)*12 + CAST(substr(pco_created_at,6,2) AS INTEGER) - 1 AS smi,
                CASE WHEN archived_at IS NULL THEN ?
                     ELSE CAST(substr(archived_at,1,4) AS INTEGER)*12 + CAST(substr(archived_at,6,2) AS INTEGER) - 1 END AS emi
           FROM pco_team_memberships WHERE org_id = ? AND pco_created_at IS NOT NULL AND person_id != ''
       ) GROUP BY pid`,
    )
    .all(currentMi, orgId, currentMi, orgId) as Array<{ pid: string; mfirst: number; mlast: number }>;
  const memSpan = new Map<string, { mfirst: number; mlast: number }>();
  for (const m of memRows) memSpan.set(m.pid, { mfirst: m.mfirst, mlast: m.mlast });

  const monthIdxOf = (iso: string) => Number(iso.slice(0, 4)) * 12 + (Number(iso.slice(5, 7)) - 1);

  const yearAgg = new Map<string, { joined: number; retained: number }>();
  const monthAgg = new Map<string, { joined: number; retained: number }>();
  // Members carry an engaged SPAN [startIdx, endIdx]; survival at period P =
  // start <= P <= end. Built three ways from one pass:
  //  • byYear/byMonth (retention-% chart) — by JOIN year, current classification.
  //  • interactionMembers (Interaction decay) — by JOIN year; span = from joining
  //    until their last ANY PCO touch (activity OR profile edit) ages out. EVERY
  //    record of every classification (shepherded/active/present/inactive), so it
  //    shows the full "came in / stuck or timed out" funnel.
  //  • engagedMembers (Retention decay) — by the year a person first became
  //    ENGAGED (shepherded OR active); span covers their shepherded membership
  //    plus the window after their last dated activity. Never-engaged drop out.
  interface Member { startIdx: number; endIdx: number }
  const interactionMembers = new Map<number, Member[]>();
  const engagedMembers = new Map<number, Member[]>();
  for (const r of rows) {
    const jy = Number(r.created.slice(0, 4));
    if (jy && jy >= PCT_START_YEAR) {
      bump(yearAgg, String(jy), r.retained);
      bump(monthAgg, r.created.slice(0, 7), r.retained);
      // Interaction decay: join cohort; survives while their last PCO touch
      // (activity OR profile create/edit) is within the window. No touch at all
      // → endIdx = -Infinity (counts in the cohort size but never "survives").
      const last = r.lastActivity ? monthIdxOf(r.lastActivity) : -Infinity;
      const arr = interactionMembers.get(jy) ?? [];
      arr.push({ startIdx: monthIdxOf(r.created), endIdx: last === -Infinity ? -Infinity : last + win - 1 });
      interactionMembers.set(jy, arr);
    }
    // Retention decay: engaged = shepherded (membership span) OR active (dated
    // activity + window). Cohort = year of first engagement, regardless of join.
    const mem = memSpan.get(r.personId);
    const starts: number[] = [];
    const ends: number[] = [];
    if (r.firstMi != null && r.lastMi != null) { starts.push(r.firstMi); ends.push(r.lastMi + win - 1); }
    if (mem) { starts.push(mem.mfirst); ends.push(mem.mlast); }
    if (starts.length) {
      const startIdx = Math.min(...starts);
      const ey = Math.floor(startIdx / 12);
      if (ey >= RETENTION_START_YEAR && ey <= currentYear) {
        const arr = engagedMembers.get(ey) ?? [];
        arr.push({ startIdx, endIdx: Math.max(...ends) });
        engagedMembers.set(ey, arr);
      }
    }
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

  // ── Decay builder: SURVIVAL of each cohort as of each period ─────────
  // A member survives at period P when their engaged span covers it
  // (startIdx <= P <= endIdx). The span already bakes in the activity window,
  // so this is just an interval test. A cohort builds up as people start
  // through the year, then decays as spans end.
  const currentMonth = new Date().getUTCMonth() + 1; // 1-indexed
  const survivedAt = (members: Member[], periodIdx: number): number => {
    let c = 0;
    for (const m of members) if (m.startIdx <= periodIdx && m.endIdx >= periodIdx) c++;
    return c;
  };
  const buildDecay = (cohorts: Map<number, Member[]>): CohortDecay[] =>
    [...cohorts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, members]) => {
        const size = members.length;
        const pct = (count: number) => (size > 0 ? Math.round((count / size) * 100) : 0);
        const points: Array<{ year: number; pct: number; count: number }> = [];
        for (let Y = year; Y <= currentYear; Y++) {
          // Past years: as of December. Current year: as of this month (Dec is
          // still in the future, so open memberships/recent activity wouldn't
          // reach it yet → would undercount).
          const count = survivedAt(members, Math.min(Y * 12 + 11, currentMi));
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

  const decay = buildDecay(engagedMembers);
  const interactionDecay = buildDecay(interactionMembers);

  // ── Reactivations (lapsed → returned): read the nightly-precomputed
  //    table (refreshRetentionReturns, run during the dashboard refresh).
  //    Computing this live scans ~330k dated activity rows and 502'd the
  //    page, so the request just reads these few rows. Returns are counted
  //    by the year a person came back — i.e. a fresh re-entrance that year.
  let reactivations: Array<{ year: number; count: number }> = [];
  try {
    reactivations = getDb()
      .prepare(
        `SELECT year, count FROM retention_returns
          WHERE org_id = ? AND year >= ? AND year <= ?
          ORDER BY year`,
      )
      .all(orgId, PCT_START_YEAR, currentYear) as Array<{ year: number; count: number }>;
  } catch {
    reactivations = [];
  }

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
  // Steady-state annual loss rate over a calendar-year span: per cohort, the
  // fraction of still-engaged members lost year over year, skipping each
  // cohort's first (ramp-up) year so we measure decay, not arrival.
  const decayTrendOver = (yLo: number, yHi: number): number | null => {
    const rs: number[] = [];
    for (const c of decay) {
      for (let k = 2; k < c.points.length; k++) {
        const y = c.points[k].year;
        if (y < yLo || y > yHi) continue;
        const prev = c.points[k - 1].count;
        if (prev > 0) rs.push(Math.max(0, 1 - c.points[k].count / prev));
      }
    }
    return rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) : null;
  };
  const preCovidDecay = decayTrendOver(2017, 2019);
  const postCovidDecay = decayTrendOver(2022, currentYear);
  const totalAtYear = (Y: number) => decay.reduce((a, c) => a + (c.points.find((p) => p.year === Y)?.count ?? 0), 0);

  const decayTrends: RetentionInsight[] = [];
  // (a) decay trend, pre-COVID
  if (preCovidDecay != null) {
    decayTrends.push({
      title: `Pre-COVID: ~${preCovidDecay}%/yr lost`,
      detail: `Before 2020, an engaged cohort shed about ${preCovidDecay}% of its remaining people each year.`,
      tone: preCovidDecay >= 20 ? "down" : "neutral",
    });
  }
  // (b) decay trend, post-COVID
  if (postCovidDecay != null) {
    const cmp = preCovidDecay != null
      ? ` — ${postCovidDecay > preCovidDecay ? "faster" : postCovidDecay < preCovidDecay ? "slower" : "about the same as"} than the ~${preCovidDecay}% pre-COVID`
      : "";
    decayTrends.push({
      title: `Post-COVID: ~${postCovidDecay}%/yr lost`,
      detail: `Since 2022, cohorts lose about ${postCovidDecay}% of remaining people per year${cmp}.`,
      tone: preCovidDecay != null && postCovidDecay > preCovidDecay ? "down" : "up",
    });
  }
  // (c) the impact of COVID
  const preTotal = totalAtYear(2019);
  const troughTotal = Math.min(totalAtYear(2020), totalAtYear(2021));
  const nowTotal = totalAtYear(currentYear);
  if (preTotal > 0 && troughTotal > 0) {
    const dropPct = Math.round((1 - troughTotal / preTotal) * 100);
    const recoveredPct = Math.round((nowTotal / preTotal) * 100);
    decayTrends.push({
      title: `COVID hit: −${dropPct}% engaged`,
      detail:
        recoveredPct >= 95
          ? `The engaged base fell ${dropPct}% from 2019 to the 2020–21 low, then recovered to ~${recoveredPct}% of pre-COVID.`
          : `The engaged base fell ${dropPct}% from 2019 to the 2020–21 low and sits at ~${recoveredPct}% of pre-COVID today — a lasting step down, not a full rebound.`,
      tone: recoveredPct >= 95 ? "neutral" : "down",
    });
  }
  // (d) the trend since COVID: engaged base recovering year over year
  const t2020 = totalAtYear(2020);
  const t2021 = totalAtYear(2021);
  const troughYear = t2021 <= t2020 ? 2021 : 2020;
  const troughVal = Math.min(t2020, t2021);
  const nowVal = totalAtYear(currentYear);
  if (troughVal > 0 && nowVal > 0) {
    const growthPct = Math.round((nowVal / troughVal - 1) * 100);
    decayTrends.push({
      title: growthPct > 0 ? `Up ${growthPct}% since the COVID low` : `Flat since the COVID low`,
      detail: `The engaged base has climbed from ${troughVal.toLocaleString()} (${troughYear}) to ${nowVal.toLocaleString()} (${currentYear}) — retention has been rising year over year since COVID.`,
      tone: growthPct > 0 ? "up" : "neutral",
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
    interactionDecay,
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

/** Nightly precompute for the Returns chart. Walks each person's distinct
 *  months of dated activity (check-ins, plan serving, event attendance),
 *  finds gaps longer than the activity window, and counts each post-gap
 *  return by the calendar year it happened.
 *
 *  The scan de-dups ~330k dated rows and takes ~2 min. better-sqlite3 is
 *  synchronous, so running it on the main connection would freeze the single
 *  Node worker for everyone. The DB is in WAL mode (readers don't block
 *  writers), so we run the heavy SELECT in a child `sqlite3` process — the
 *  event loop stays free — and then do the tiny write back on the main
 *  connection. Call only from the dashboard refresh / cron, never a request. */
export async function refreshRetentionReturns(orgId: number): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const win = getSyncSettings(orgId).activityMonths;
  const currentYear = new Date().getUTCFullYear();
  const startYear = RETENTION_START_YEAR;
  const cutoff = `${startYear - 1}`;
  const db = getDb();
  const dbFile = db.name; // exact file the app opened

  // orgId/win/years are integers from our own data; cutoff is a fixed string.
  const sql = `
    WITH am AS (
      SELECT pid, CAST(substr(ym,1,4) AS INTEGER)*12 + CAST(substr(ym,6,2) AS INTEGER) - 1 AS mi
      FROM (
        SELECT person_id AS pid, substr(event_starts_at,1,7) AS ym
          FROM pco_event_attendances WHERE org_id=${orgId} AND attended=1 AND event_starts_at >= '${cutoff}'
        UNION
        SELECT person_id AS pid, substr(event_time_at,1,7) AS ym
          FROM pco_check_ins WHERE org_id=${orgId} AND person_id IS NOT NULL AND event_time_at >= '${cutoff}'
        UNION
        SELECT pp.person_id AS pid, substr(pl.sort_date,1,7) AS ym
          FROM pco_plan_people pp JOIN pco_plans pl ON pl.org_id=pp.org_id AND pl.pco_id=pp.plan_id
         WHERE pp.org_id=${orgId} AND pl.sort_date >= '${cutoff}'
      )
    ),
    g AS (SELECT mi, mi - LAG(mi) OVER (PARTITION BY pid ORDER BY mi) AS gap FROM am)
    SELECT (mi/12) AS year, COUNT(*) AS count
      FROM g WHERE gap > ${win} AND (mi/12) BETWEEN ${startYear} AND ${currentYear}
     GROUP BY year ORDER BY year;`;

  // Absolute path by default so we don't depend on the pm2 process PATH.
  const { stdout } = await run(
    process.env.SQLITE3_BIN ?? "/usr/bin/sqlite3",
    ["-readonly", dbFile, sql],
    { timeout: 5 * 60_000, maxBuffer: 1 << 20 },
  );
  const rows = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [y, c] = line.split("|");
      return { year: Number(y), count: Number(c) };
    })
    .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.count));

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM retention_returns WHERE org_id = ?").run(orgId);
    const ins = db.prepare(
      "INSERT INTO retention_returns (org_id, year, count) VALUES (?, ?, ?)",
    );
    for (const r of rows) ins.run(orgId, r.year, r.count);
  });
  tx();

  // ── Per-person first/last engagement month (same sources, same child
  //    process). Re-bases the decay on the year a person first actually
  //    engaged. UNION ALL is fine here — MIN/MAX don't need de-duped months. ──
  const engSql = `
    WITH am AS (
      SELECT pid, CAST(substr(ym,1,4) AS INTEGER)*12 + CAST(substr(ym,6,2) AS INTEGER) - 1 AS mi
      FROM (
        SELECT person_id AS pid, substr(event_starts_at,1,7) AS ym
          FROM pco_event_attendances WHERE org_id=${orgId} AND attended=1 AND event_starts_at >= '${cutoff}'
        UNION ALL
        SELECT person_id AS pid, substr(event_time_at,1,7) AS ym
          FROM pco_check_ins WHERE org_id=${orgId} AND person_id IS NOT NULL AND event_time_at >= '${cutoff}'
        UNION ALL
        SELECT pp.person_id AS pid, substr(pl.sort_date,1,7) AS ym
          FROM pco_plan_people pp JOIN pco_plans pl ON pl.org_id=pp.org_id AND pl.pco_id=pp.plan_id
         WHERE pp.org_id=${orgId} AND pl.sort_date >= '${cutoff}'
      )
    )
    SELECT pid, MIN(mi) AS first_mi, MAX(mi) AS last_mi
      FROM am
     WHERE pid IS NOT NULL AND pid != '' AND mi <= ${currentYear} * 12 + 11
     GROUP BY pid;`;
  const { stdout: engOut } = await run(
    process.env.SQLITE3_BIN ?? "/usr/bin/sqlite3",
    ["-readonly", dbFile, engSql],
    { timeout: 5 * 60_000, maxBuffer: 32 << 20 },
  );
  const eng = engOut
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [pid, f, l] = line.split("|");
      return { pid, first: Number(f), last: Number(l) };
    })
    .filter((e) => e.pid && Number.isFinite(e.first) && Number.isFinite(e.last));

  const engTx = db.transaction(() => {
    db.prepare("DELETE FROM retention_engagement WHERE org_id = ?").run(orgId);
    const ins = db.prepare(
      "INSERT INTO retention_engagement (org_id, person_id, first_mi, last_mi) VALUES (?, ?, ?, ?)",
    );
    for (const e of eng) ins.run(orgId, e.pid, e.first, e.last);
  });
  engTx();
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monthLabel(key: string): string {
  const mo = Number(key.slice(5, 7));
  return `${MONTHS[mo - 1] ?? key.slice(5, 7)} ${key.slice(0, 4)}`;
}
