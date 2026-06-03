import "server-only";
import type { WeeklyAttendanceRow } from "./attendance-read";
import type { SeasonalInsight } from "./attendance-seasonal";
import { isExcludingReason } from "./attendance-exclusion";

// BACKLOG: Giving vs. attendance — bookmarked for when giving data is
// imported (PCO Giving). Would correlate weekly giving against weekly
// attendance and per-attender giving over time. No giving source yet.

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export interface FamilyAnalysis {
  insights: SeasonalInsight[];
  /** Kids as a % of in-person attendance, per row (null where unknown
   *  or excluded) — for the right-axis line on the family chart. */
  kidsShare: (number | null)[];
}

/** Adults vs. kids attendance: current kids share, its multi-year
 *  trend (a proxy for young families), kids-per-adult, and whether
 *  adults & kids move together. Exception weeks excluded. */
export function analyzeFamilyTrends(rows: WeeklyAttendanceRow[]): FamilyAnalysis {
  const insights: SeasonalInsight[] = [];

  const kidsShare = rows.map((r) => {
    if (isExcludingReason(r.exception_reason)) return null;
    if (r.kids_total != null && r.in_person_total && r.in_person_total > 0) {
      return (r.kids_total / r.in_person_total) * 100;
    }
    return null;
  });

  const adult: number[] = [];
  const kids: number[] = [];
  const shareByYear = new Map<number, number[]>();
  for (const r of rows) {
    if (isExcludingReason(r.exception_reason)) continue;
    if (r.adult_total != null && r.kids_total != null) {
      adult.push(r.adult_total);
      kids.push(r.kids_total);
    }
    const ip = r.in_person_total;
    if (r.kids_total != null && ip && ip > 0) {
      const y = Number(r.week_date.slice(0, 4));
      if (!shareByYear.has(y)) shareByYear.set(y, []);
      shareByYear.get(y)!.push((r.kids_total / ip) * 100);
    }
  }

  if (adult.length < 8 && shareByYear.size === 0) {
    return { insights, kidsShare };
  }

  // Current kids share.
  const allShares = [...shareByYear.values()].flat();
  if (allShares.length > 0) {
    insights.push({
      title: "Kids' share of in-person attendance",
      detail: `Kids are about ${mean(allShares).toFixed(0)}% of in-person attendance on a typical Sunday.`,
      tone: "neutral",
    });
  }

  // Multi-year trend in the kids share (5-year window).
  const yearShares = [...shareByYear.entries()]
    .filter(([, v]) => v.length >= 10)
    .map(([y, v]) => ({ y, avg: mean(v) }))
    .sort((a, b) => a.y - b.y);
  if (yearShares.length >= 2) {
    const recent = yearShares.slice(-5);
    const f = recent[0];
    const l = recent[recent.length - 1];
    const delta = Math.round(l.avg - f.avg); // percentage points
    insights.push({
      title:
        delta > 0
          ? "More kids over time (younger church)"
          : delta < 0
            ? "Fewer kids over time"
            : "Kids' share is holding steady",
      detail: `Kids went from ${f.avg.toFixed(0)}% of attendance (${f.y}) to ${l.avg.toFixed(0)}% (${l.y}) — ${delta >= 0 ? "+" : ""}${delta} points.`,
      tone: delta > 0 ? "up" : delta < 0 ? "down" : "neutral",
    });
  }

  // Kids per 10 adults.
  if (adult.length > 0) {
    const totalKids = kids.reduce((a, b) => a + b, 0);
    const totalAdult = adult.reduce((a, b) => a + b, 0);
    if (totalAdult > 0) {
      insights.push({
        title: "Kids per adult",
        detail: `About ${((totalKids / totalAdult) * 10).toFixed(1)} kids in worship for every 10 adults.`,
        tone: "neutral",
      });
    }
  }

  // Do adults and kids move together?
  const c = pearson(adult, kids);
  if (c != null) {
    insights.push({
      title:
        c > 0.3
          ? "Adults and kids rise and fall together"
          : "Adult and kid attendance move independently",
      detail: `Adult and kids attendance correlate r = ${c.toFixed(2)} across ${adult.length} weeks${c > 0.3 ? " — families tend to come as a unit." : "."}`,
      tone: "neutral",
    });
  }

  return { insights, kidsShare };
}
