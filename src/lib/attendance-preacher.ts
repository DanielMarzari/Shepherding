import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import type { WeeklyAttendanceRow } from "./attendance-read";
import type { SeasonalInsight } from "./attendance-seasonal";

// This church's lead pastors. Everyone else who preaches regularly is
// "teaching team"; anyone who preaches < GUEST_MAX Sundays is a "guest".
const LEAD_RE = /\b(joe|joseph|joey|brad|bradley)\b/i;
const GUEST_MAX = 8;

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

/** Who preached each Sunday, keyed by 'YYYY-MM-DD'. Looks at PCO
 *  Services plan assignments whose position (or team) names a preacher /
 *  teacher / speaker, and — when a date has plans in several service
 *  types — prefers the LIVE / main worship service. */
export function getPreacherByWeek(
  orgId: number,
  weekDates: string[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (weekDates.length === 0) return out;
  const wanted = new Set(weekDates);
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT substr(pl.sort_date, 1, 10) AS date,
              pp.person_id AS personId,
              p.enc_pii AS encPii,
              st.name AS serviceType,
              pp.team_position_name AS pos,
              t.name AS teamName
         FROM pco_plan_people pp
         JOIN pco_plans pl
           ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
         LEFT JOIN pco_service_types st
           ON st.org_id = pl.org_id AND st.pco_id = pl.service_type_id
         LEFT JOIN pco_teams t
           ON t.org_id = pp.org_id AND t.pco_id = pp.team_id
         JOIN pco_people p
           ON p.org_id = pp.org_id AND p.pco_id = pp.person_id
        WHERE pp.org_id = ?
          AND lower(coalesce(pp.status, 'c')) NOT IN ('d', 'declined')
          AND (
               lower(coalesce(pp.team_position_name, '')) LIKE '%preach%'
            OR lower(coalesce(pp.team_position_name, '')) LIKE '%speaker%'
            OR lower(coalesce(pp.team_position_name, '')) LIKE '%sermon%'
            OR lower(coalesce(pp.team_position_name, '')) LIKE '%teaching%'
            OR lower(coalesce(pp.team_position_name, '')) LIKE '%message%'
            OR lower(coalesce(pp.team_position_name, '')) LIKE '%homil%'
            OR lower(coalesce(t.name, '')) LIKE '%preach%'
          )`,
    )
    .all(orgId) as Array<{
    date: string | null;
    personId: string;
    encPii: string | null;
    serviceType: string | null;
    pos: string | null;
    teamName: string | null;
  }>;

  // Pick one preacher per date — prefer the LIVE/main service.
  const best = new Map<string, { name: string; rank: number }>();
  for (const r of rows) {
    if (!r.date || !wanted.has(r.date)) continue;
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const name =
      [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") || null;
    if (!name) continue;
    const rank = /live|stream|main|sunday|worship|morning/i.test(
      r.serviceType ?? "",
    )
      ? 2
      : 1;
    const cur = best.get(r.date);
    if (!cur || rank > cur.rank) best.set(r.date, { name, rank });
  }
  for (const [d, v] of best) out.set(d, v.name);
  return out;
}

export interface PreacherStat {
  name: string;
  avg: number;
  weeks: number;
}
export interface PreacherAnalysis {
  /** Preacher name per attendance row (null where unknown). */
  perWeek: (string | null)[];
  /** Avg in-person attendance per preacher, most Sundays first. */
  stats: PreacherStat[];
}

/** Align preachers to the attendance rows and roll up average in-person
 *  attendance per preacher (excluding exception weeks and blanks). */
export function analyzePreachers(
  rows: WeeklyAttendanceRow[],
  preacherByDate: Map<string, string>,
): PreacherAnalysis {
  const perWeek = rows.map((r) => preacherByDate.get(r.week_date) ?? null);
  const byName = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const name = perWeek[i];
    if (!name || r.exception_reason || r.in_person_total == null) return;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(r.in_person_total);
  });
  const stats: PreacherStat[] = [...byName.entries()]
    .map(([name, vals]) => ({
      name,
      avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      weeks: vals.length,
    }))
    .sort((a, b) => b.weeks - a.weeks || b.avg - a.avg);
  return { perWeek, stats };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function pctDiff(part: number, base: number): number {
  return base === 0 ? 0 : Math.round(((part - base) / base) * 100);
}

/** Does WHO preaches actually move attendance, or is turnout consistent
 *  regardless? Compares guest speakers vs the teaching team vs the lead
 *  pastors, calls out the leads individually, and reports a one-way
 *  ANOVA η² — the share of week-to-week attendance variation explained
 *  by the preacher. Exception weeks and blanks are excluded. */
export function analyzePreacherTrends(
  rows: WeeklyAttendanceRow[],
  perWeek: (string | null)[],
  stats: PreacherStat[],
): { insights: SeasonalInsight[] } {
  const insights: SeasonalInsight[] = [];
  const samplesByName = new Map<string, number[]>();
  const all: number[] = [];
  rows.forEach((r, i) => {
    const name = perWeek[i];
    if (!name || r.exception_reason || r.in_person_total == null) return;
    if (!samplesByName.has(name)) samplesByName.set(name, []);
    samplesByName.get(name)!.push(r.in_person_total);
    all.push(r.in_person_total);
  });
  if (all.length < 10 || stats.length < 2) return { insights };

  const grand = mean(all);
  const weeksOf = (name: string) =>
    stats.find((s) => s.name === name)?.weeks ?? 0;
  const leadNames = stats.filter((s) => LEAD_RE.test(s.name)).map((s) => s.name);
  const isLead = (name: string) => leadNames.includes(name);
  const isGuest = (name: string) => !isLead(name) && weeksOf(name) < GUEST_MAX;

  const lead: number[] = [];
  const team: number[] = [];
  const guest: number[] = [];
  for (const [name, vals] of samplesByName) {
    if (isLead(name)) lead.push(...vals);
    else if (isGuest(name)) guest.push(...vals);
    else team.push(...vals);
  }
  const regular = [...lead, ...team];

  // Guest speakers vs regular preachers.
  if (guest.length >= 3 && regular.length >= 5) {
    const g = mean(guest);
    const r = mean(regular);
    const d = pctDiff(g, r);
    insights.push({
      title:
        Math.abs(d) < 3
          ? "Guest speakers draw about the same"
          : d > 0
            ? "Guest speakers draw more"
            : "Guest speakers draw fewer",
      detail: `On the ${guest.length} Sundays with a guest speaker (< ${GUEST_MAX} appearances), attendance averaged ${Math.round(g).toLocaleString()} vs ${Math.round(r).toLocaleString()} with regular preachers — about ${Math.abs(d)}% ${d >= 0 ? "higher" : "lower"}.`,
      tone: Math.abs(d) < 3 ? "neutral" : d > 0 ? "up" : "down",
    });
  }

  // Lead pastors vs teaching team.
  if (lead.length >= 5 && team.length >= 3) {
    const l = mean(lead);
    const t = mean(team);
    const d = pctDiff(l, t);
    insights.push({
      title:
        Math.abs(d) < 3
          ? "Lead pastors and teaching team draw the same"
          : d > 0
            ? "Higher when a lead pastor preaches"
            : "Higher when the teaching team preaches",
      detail: `When ${leadNames.join(" or ")} preach, attendance averages ${Math.round(l).toLocaleString()}; the rest of the teaching team averages ${Math.round(t).toLocaleString()} — about ${Math.abs(d)}% ${d >= 0 ? "higher" : "lower"} for the lead pastors.`,
      tone: "neutral",
    });
  }

  // The two leads head-to-head.
  if (leadNames.length >= 2) {
    const [a, b] = leadNames
      .map((n) => ({ name: n, avg: mean(samplesByName.get(n) ?? [grand]), weeks: weeksOf(n) }))
      .sort((x, y) => y.weeks - x.weeks);
    const d = pctDiff(a.avg, b.avg);
    insights.push({
      title:
        Math.abs(d) < 2
          ? `${a.name} and ${b.name} draw about the same`
          : `${(d > 0 ? a : b).name} draws slightly more`,
      detail: `${a.name} averages ${Math.round(a.avg).toLocaleString()} over ${a.weeks} Sundays; ${b.name} averages ${Math.round(b.avg).toLocaleString()} over ${b.weeks} — a ${Math.abs(d)}% difference.`,
      tone: "neutral",
    });
  }

  // One-way ANOVA η² — share of variance explained by the preacher.
  // Groups: each preacher with ≥8 Sundays is its own group; all guests
  // are pooled into one "guest" group.
  const groups: number[][] = [];
  const guestPool: number[] = [];
  for (const [name, vals] of samplesByName) {
    if (weeksOf(name) >= GUEST_MAX || isLead(name)) groups.push(vals);
    else guestPool.push(...vals);
  }
  if (guestPool.length) groups.push(guestPool);
  let ssTotal = 0;
  for (const x of all) ssTotal += (x - grand) ** 2;
  let ssBetween = 0;
  for (const g of groups) {
    if (g.length === 0) continue;
    ssBetween += g.length * (mean(g) - grand) ** 2;
  }
  const eta2 = ssTotal > 0 ? ssBetween / ssTotal : 0;
  const explained = Math.round(eta2 * 100);
  insights.push({
    title:
      explained < 10
        ? "Attendance is consistent regardless of preacher"
        : explained < 25
          ? "The preacher has a modest effect on attendance"
          : "The preacher has a strong effect on attendance",
    detail: `Who preaches explains about ${explained}% of the week-to-week variation in attendance (one-way ANOVA η² = ${eta2.toFixed(2)}, across ${groups.length} preacher groups and ${all.length} Sundays). ${
      explained < 10
        ? "Turnout is largely the same no matter who's in the pulpit — seasonality and weather matter more."
        : "Some preachers are associated with measurably different crowds."
    }`,
    tone: "neutral",
  });

  return { insights };
}
