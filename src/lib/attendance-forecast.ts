import "server-only";
import type { WeeklyAttendanceRow } from "./attendance-read";
import { isExcludingReason } from "./attendance-exclusion";

export interface CategoryProjection {
  key: string;
  label: string;
  history: Array<{ year: number; avg: number; weeks: number }>;
  latestYear: number | null;
  latestAvg: number | null;
  proj2026: number | null;
  proj2027: number | null;
  /** Trend as a % of the latest average, per year. */
  perYearPct: number | null;
}

const CATS: Array<{ key: keyof WeeklyAttendanceRow; label: string }> = [
  { key: "in_person_total", label: "Total in-person" },
  { key: "adult_total", label: "Adults" },
  { key: "center_total", label: "Center" },
  { key: "chapel_total", label: "Chapel" },
  { key: "kids_total", label: "Kids" },
  { key: "student_total", label: "Students" },
  { key: "online_live", label: "Online" },
];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Least-squares slope/intercept for points (x, y). */
function linfit(pts: Array<{ x: number; y: number }>): { slope: number; intercept: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  const mx = mean(pts.map((p) => p.x));
  const my = mean(pts.map((p) => p.y));
  let num = 0, den = 0;
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

/** Project each attendance category to 2026 & 2027 from its recent yearly
 *  averages. Fit uses post-COVID years (2022+) to avoid the 2020–21 distortion,
 *  falling back to all reliable years if there aren't enough. */
export function projectAttendance(rows: WeeklyAttendanceRow[]): { categories: CategoryProjection[]; method: string } {
  const out: CategoryProjection[] = [];
  for (const cat of CATS) {
    const byYear = new Map<number, number[]>();
    for (const r of rows) {
      if (isExcludingReason(r.exception_reason)) continue;
      const v = r[cat.key];
      if (typeof v !== "number") continue;
      const y = Number(r.week_date.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(v);
    }
    const history = [...byYear.entries()]
      .map(([year, vs]) => ({ year, avg: Math.round(mean(vs)), weeks: vs.length }))
      .filter((h) => h.weeks >= 20) // only years with enough Sundays to be reliable
      .sort((a, b) => a.year - b.year);
    if (history.length === 0) continue;

    const latest = history[history.length - 1];
    // Fit the most recent 3 reliable years — reflects CURRENT momentum and
    // excludes the 2020–21 COVID recovery bounce, which would overstate the
    // slope (growth has been decelerating).
    let fit = history.slice(-3);
    if (fit.length < 2) fit = history;
    const lf = linfit(fit.map((h) => ({ x: h.year, y: h.avg })));
    const proj = (y: number) => (lf ? Math.max(0, Math.round(lf.intercept + lf.slope * y)) : null);
    const perYearPct = lf && latest.avg > 0 ? Math.round((lf.slope / latest.avg) * 100) : null;

    out.push({
      key: String(cat.key),
      label: cat.label,
      history,
      latestYear: latest.year,
      latestAvg: latest.avg,
      proj2026: proj(2026),
      proj2027: proj(2027),
      perYearPct,
    });
  }
  return {
    categories: out,
    method: "Linear trend on each category's yearly average over its last 3 reliable years (so it reflects current momentum, not the post-COVID recovery bounce), projected to 2026 and 2027. Exception/closure weeks excluded; only years with 20+ Sundays count.",
  };
}
