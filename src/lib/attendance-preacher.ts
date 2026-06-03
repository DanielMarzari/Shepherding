import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import type { WeeklyAttendanceRow } from "./attendance-read";
import type { SeasonalInsight } from "./attendance-seasonal";
import { isExcludingReason } from "./attendance-exclusion";

// Preacher categorization for this church:
//  - Joe is the sole lead pastor (keeps his own name as the label).
//  - Brad left the rotation (~2022) → excluded from all analysis.
//  - Teaching team = Sam Chen, Dave Peters, Tim Azevedo, (occ.) Claudio.
//  - Summer cohort = the biennial summer teaching cohort — one-off
//    preachers in Jun–Aug of even years (2020, 2022, 2024, 2026, …).
//  - Anyone else = Guest.
const LEAD_RE = /\b(joe|joseph|joey)\b/i;
const EXCLUDE_RE = /\b(brad|bradley)\b/i;
const TEAM_RES = [/chen/i, /(dave|david)\s+peters/i, /azevedo/i, /claudio/i];

const TEAM_LABEL = "Teaching team";
const COHORT_LABEL = "Summer cohort";
const GUEST_LABEL = "Guest";
const GROUP_LABELS = new Set([TEAM_LABEL, COHORT_LABEL, GUEST_LABEL]);

/** Map a raw preacher name + Sunday to a category label, or null to
 *  exclude the week from all preacher analysis (e.g. Brad). The lead
 *  keeps his real name so he shows individually. */
function categorize(name: string, date: string): string | null {
  if (EXCLUDE_RE.test(name)) return null;
  if (LEAD_RE.test(name)) return name;
  if (TEAM_RES.some((re) => re.test(name))) return TEAM_LABEL;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (m >= 6 && m <= 8 && y % 2 === 0) return COHORT_LABEL;
  return GUEST_LABEL;
}

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
  // perWeek holds the CATEGORY label (lead's name, "Teaching team",
  // "Summer cohort", "Guest"), or null when unknown / excluded (Brad).
  const perWeek = rows.map((r) => {
    const name = preacherByDate.get(r.week_date);
    return name ? categorize(name, r.week_date) : null;
  });
  const byName = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const name = perWeek[i];
    if (!name || isExcludingReason(r.exception_reason) || r.in_person_total == null)
      return;
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
 *  regardless? Works off the category labels (lead's name, "Teaching
 *  team", "Summer cohort", "Guest"); Brad is already excluded upstream.
 *  Compares each group against the lead and reports a one-way ANOVA η² —
 *  the share of week-to-week attendance variation explained by who
 *  preached. Exception weeks and blanks are excluded. */
export function analyzePreacherTrends(
  rows: WeeklyAttendanceRow[],
  perWeek: (string | null)[],
): { insights: SeasonalInsight[] } {
  const insights: SeasonalInsight[] = [];
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  rows.forEach((r, i) => {
    const label = perWeek[i];
    if (!label || isExcludingReason(r.exception_reason) || r.in_person_total == null)
      return;
    if (!byCat.has(label)) byCat.set(label, []);
    byCat.get(label)!.push(r.in_person_total);
    all.push(r.in_person_total);
  });
  if (all.length < 10 || byCat.size < 2) return { insights };

  const grand = mean(all);
  // The lead is the only label that isn't one of the group labels.
  const leadLabel =
    [...byCat.keys()].find((l) => !GROUP_LABELS.has(l)) ?? null;
  const lead = leadLabel ? (byCat.get(leadLabel) ?? []) : [];
  const team = byCat.get(TEAM_LABEL) ?? [];
  const cohort = byCat.get(COHORT_LABEL) ?? [];
  const guest = byCat.get(GUEST_LABEL) ?? [];
  const regular = [...lead, ...team];

  // Lead vs teaching team.
  if (lead.length >= 5 && team.length >= 3 && leadLabel) {
    const l = mean(lead);
    const t = mean(team);
    const d = pctDiff(l, t);
    insights.push({
      title:
        Math.abs(d) < 3
          ? `${leadLabel} and the teaching team draw the same`
          : d > 0
            ? `Higher when ${leadLabel} preaches`
            : "Higher when the teaching team preaches",
      detail: `${leadLabel} averages ${Math.round(l).toLocaleString()} over ${lead.length} Sundays; the teaching team (Sam Chen, Dave Peters, Tim Azevedo, Claudio) averages ${Math.round(t).toLocaleString()} over ${team.length} — about ${Math.abs(d)}% ${d >= 0 ? "higher" : "lower"} for ${leadLabel}.`,
      tone: "neutral",
    });
  }

  // Summer cohort (biennial one-offs) vs regular preachers.
  if (cohort.length >= 3 && regular.length >= 5) {
    const c = mean(cohort);
    const r = mean(regular);
    const d = pctDiff(c, r);
    insights.push({
      title:
        Math.abs(d) < 3
          ? "Summer cohort draws about the same"
          : d > 0
            ? "Summer cohort draws more"
            : "Summer cohort draws fewer",
      detail: `On the ${cohort.length} summer-cohort Sundays (biennial one-off preachers), attendance averaged ${Math.round(c).toLocaleString()} vs ${Math.round(r).toLocaleString()} with the regular preachers — about ${Math.abs(d)}% ${d >= 0 ? "higher" : "lower"}. Note these fall in summer, which runs lower on its own.`,
      tone: Math.abs(d) < 3 ? "neutral" : d > 0 ? "up" : "down",
    });
  }

  // Other guests vs regular preachers (only if there are enough).
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
      detail: `On the ${guest.length} other guest-speaker Sundays, attendance averaged ${Math.round(g).toLocaleString()} vs ${Math.round(r).toLocaleString()} with the regular preachers — about ${Math.abs(d)}% ${d >= 0 ? "higher" : "lower"}.`,
      tone: Math.abs(d) < 3 ? "neutral" : d > 0 ? "up" : "down",
    });
  }

  // One-way ANOVA η² across the categories — share of attendance
  // variation explained by who preached.
  const groups = [...byCat.values()].filter((g) => g.length > 0);
  let ssTotal = 0;
  for (const x of all) ssTotal += (x - grand) ** 2;
  let ssBetween = 0;
  for (const g of groups) ssBetween += g.length * (mean(g) - grand) ** 2;
  const eta2 = ssTotal > 0 ? ssBetween / ssTotal : 0;
  const explained = Math.round(eta2 * 100);
  insights.push({
    title:
      explained < 10
        ? "Attendance is consistent regardless of preacher"
        : explained < 25
          ? "The preacher has a modest effect on attendance"
          : "The preacher has a strong effect on attendance",
    detail: `Who preaches explains about ${explained}% of the week-to-week variation in attendance (one-way ANOVA η² = ${eta2.toFixed(2)}, across ${groups.length} groups and ${all.length} Sundays). ${
      explained < 10
        ? "Turnout is largely the same no matter who's in the pulpit — seasonality and weather matter more."
        : "Some groups are associated with measurably different crowds."
    }`,
    tone: "neutral",
  });

  return { insights };
}
