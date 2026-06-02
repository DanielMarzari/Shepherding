import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import type { WeeklyAttendanceRow } from "./attendance-read";

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
