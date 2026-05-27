import "server-only";
import { getDb } from "./db";

export interface WeeklyAttendanceRow {
  week_date: string;
  in_person_total: number | null;
  kids_total: number | null;
  student_total: number | null;
  adult_total: number | null;
  online_live: number | null;
  online_on_demand: number | null;
  abfs: number | null;
}

export interface WeeklyAttendanceSummary {
  rows: WeeklyAttendanceRow[];
  earliest: string | null;
  latest: string | null;
  inPerson12moAvg: number | null;
  inPerson12moPeak: number | null;
  inPersonTrend12moDelta: number | null;
  totalSourceFiles: number;
}

export function getWeeklyAttendance(orgId: number): WeeklyAttendanceSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT week_date, in_person_total, kids_total, student_total,
              adult_total, online_live, online_on_demand, abfs
         FROM attendance_weekly
        WHERE org_id = ?
        ORDER BY week_date ASC`,
    )
    .all(orgId) as WeeklyAttendanceRow[];

  const earliest = rows[0]?.week_date ?? null;
  const latest = rows[rows.length - 1]?.week_date ?? null;
  const filesCount = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT source_file) AS c FROM attendance_weekly
          WHERE org_id = ? AND source_file IS NOT NULL`,
      )
      .get(orgId) as { c: number } | undefined
  )?.c ?? 0;

  // Last-12-months window for the headline stat — anchored to the
  // latest week, not "now", so old test data still gives a meaningful
  // number.
  let avg: number | null = null;
  let peak: number | null = null;
  let delta: number | null = null;
  if (latest) {
    const latestMs = new Date(latest).valueOf();
    const cutoffMs = latestMs - 365 * 86_400_000;
    const prevCutoffMs = cutoffMs - 365 * 86_400_000;
    const recent: number[] = [];
    const prior: number[] = [];
    for (const r of rows) {
      if (r.in_person_total == null) continue;
      const t = new Date(r.week_date).valueOf();
      if (t > cutoffMs) recent.push(r.in_person_total);
      else if (t > prevCutoffMs) prior.push(r.in_person_total);
    }
    if (recent.length > 0) {
      avg = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
      peak = Math.max(...recent);
      if (prior.length > 0) {
        const priorAvg =
          prior.reduce((a, b) => a + b, 0) / prior.length;
        delta = Math.round(((avg - priorAvg) / priorAvg) * 100);
      }
    }
  }

  return {
    rows,
    earliest,
    latest,
    inPerson12moAvg: avg,
    inPerson12moPeak: peak,
    inPersonTrend12moDelta: delta,
    totalSourceFiles: filesCount,
  };
}
