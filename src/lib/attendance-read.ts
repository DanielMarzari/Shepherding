import "server-only";
import { getDb } from "./db";
import { isExcludingReason } from "./attendance-exclusion";

export interface WeeklyAttendanceRow {
  week_date: string;
  in_person_total: number | null;
  kids_total: number | null;
  student_total: number | null;
  adult_total: number | null;
  online_live: number | null;
  online_on_demand: number | null;
  abfs: number | null;
  /** Free-text reason this week is excluded from averages (e.g. "snow
   *  closure"), or null for a normal week. */
  exception_reason: string | null;
}

export interface WeeklyAttendanceSummary {
  rows: WeeklyAttendanceRow[];
  earliest: string | null;
  latest: string | null;
  inPerson12moAvg: number | null;
  inPerson12moPeak: number | null;
  inPersonTrend12moDelta: number | null;
  /** Avg of the ADULT in-person subtotal over the last 12 months —
   *  the number /attendance now uses as "weekly attendance" instead of
   *  a manually-entered figure. */
  adult12moAvg: number | null;
  totalSourceFiles: number;
}

export interface ImportedAttendanceFile {
  sourceFile: string;
  weeks: number;
  earliest: string;
  latest: string;
}

/** Imported .xlsx files, one row per distinct source_file, so the UI
 *  can list and remove a bad import. */
export function listImportedAttendanceFiles(
  orgId: number,
): ImportedAttendanceFile[] {
  return getDb()
    .prepare(
      `SELECT source_file AS sourceFile,
              COUNT(*) AS weeks,
              MIN(week_date) AS earliest,
              MAX(week_date) AS latest
         FROM attendance_weekly
        WHERE org_id = ? AND source_file IS NOT NULL
        GROUP BY source_file
        ORDER BY MAX(week_date) DESC`,
    )
    .all(orgId) as ImportedAttendanceFile[];
}

export function getWeeklyAttendance(orgId: number): WeeklyAttendanceSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT week_date, in_person_total, kids_total, student_total,
              adult_total, online_live, online_on_demand, abfs,
              exception_reason
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
  let adultAvg: number | null = null;
  if (latest) {
    const latestMs = new Date(latest).valueOf();
    const cutoffMs = latestMs - 365 * 86_400_000;
    const prevCutoffMs = cutoffMs - 365 * 86_400_000;
    const recent: number[] = [];
    const prior: number[] = [];
    const recentAdult: number[] = [];
    for (const r of rows) {
      // Genuine exclusions (snow closures, cancellations) never count
      // toward any average; informational notes still count.
      if (isExcludingReason(r.exception_reason)) continue;
      const t = new Date(r.week_date).valueOf();
      if (r.in_person_total != null) {
        if (t > cutoffMs) recent.push(r.in_person_total);
        else if (t > prevCutoffMs) prior.push(r.in_person_total);
      }
      if (r.adult_total != null && t > cutoffMs) recentAdult.push(r.adult_total);
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
    if (recentAdult.length > 0) {
      adultAvg = Math.round(
        recentAdult.reduce((a, b) => a + b, 0) / recentAdult.length,
      );
    }
  }

  return {
    rows,
    earliest,
    latest,
    inPerson12moAvg: avg,
    inPerson12moPeak: peak,
    inPersonTrend12moDelta: delta,
    adult12moAvg: adultAvg,
    totalSourceFiles: filesCount,
  };
}
