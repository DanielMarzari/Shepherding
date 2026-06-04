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
  const kidsByYear = new Map<number, number[]>();
  let latest: string | null = null;
  for (const r of rows) {
    if (isExcludingReason(r.exception_reason)) continue;
    const y = Number(r.week_date.slice(0, 4));
    if (r.adult_total != null && r.kids_total != null) {
      adult.push(r.adult_total);
      kids.push(r.kids_total);
    }
    if (r.kids_total != null) {
      if (!kidsByYear.has(y)) kidsByYear.set(y, []);
      kidsByYear.get(y)!.push(r.kids_total);
    }
    const ip = r.in_person_total;
    if (r.kids_total != null && ip && ip > 0) {
      if (!shareByYear.has(y)) shareByYear.set(y, []);
      shareByYear.get(y)!.push((r.kids_total / ip) * 100);
      if (!latest || r.week_date > latest) latest = r.week_date;
    }
  }

  if (adult.length < 8 && shareByYear.size === 0) {
    return { insights, kidsShare };
  }

  // (1) Kids' share over the LAST YEAR (anchored to the latest week
  //     with data, so old imports don't skew it).
  if (latest) {
    const cutoff = new Date(new Date(latest).valueOf() - 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const lastYear: number[] = [];
    for (const r of rows) {
      if (isExcludingReason(r.exception_reason)) continue;
      const ip = r.in_person_total;
      if (r.kids_total != null && ip && ip > 0 && r.week_date >= cutoff) {
        lastYear.push((r.kids_total / ip) * 100);
      }
    }
    if (lastYear.length > 0) {
      insights.push({
        title: "Kids' share of in-person attendance",
        detail: `Over the last year, kids are about ${mean(lastYear).toFixed(0)}% of in-person attendance on a typical Sunday.`,
        tone: "neutral",
      });
    }
  }

  // (2) Kids COUNT over time — the absolute number in worship, across
  //     every year we have data for.
  const kidsYearAvgs = [...kidsByYear.entries()]
    .filter(([, v]) => v.length >= 6)
    .map(([y, v]) => ({ y, avg: mean(v) }))
    .sort((a, b) => a.y - b.y);
  if (kidsYearAvgs.length >= 2) {
    const f = kidsYearAvgs[0];
    const l = kidsYearAvgs[kidsYearAvgs.length - 1];
    const span = l.y - f.y;
    const totalPct = f.avg > 0 ? Math.round(((l.avg - f.avg) / f.avg) * 100) : 0;
    const perYear = span > 0 ? Math.round(totalPct / span) : totalPct;
    insights.push({
      title:
        perYear > 0
          ? "More kids over time"
          : perYear < 0
            ? "Fewer kids over time"
            : "Kids attendance is steady",
      detail: `Kids in worship went from about ${Math.round(f.avg).toLocaleString()} (${f.y}) to ${Math.round(l.avg).toLocaleString()} (${l.y}) — roughly ${perYear >= 0 ? "+" : ""}${perYear}% per year.`,
      tone: perYear > 0 ? "up" : perYear < 0 ? "down" : "neutral",
    });
  }

  // (3) Kids' SHARE of the room over time — kids relative to adults.
  //     Can fall even while the count rises (adults growing faster).
  const shareYearAvgs = [...shareByYear.entries()]
    .filter(([, v]) => v.length >= 6)
    .map(([y, v]) => ({ y, avg: mean(v) }))
    .sort((a, b) => a.y - b.y);
  if (shareYearAvgs.length >= 2) {
    const f = shareYearAvgs[0];
    const l = shareYearAvgs[shareYearAvgs.length - 1];
    const delta = Math.round(l.avg - f.avg); // percentage points
    if (delta < 0) {
      insights.push({
        title: "But kids are a shrinking share of the room",
        detail: `Kids went from ${f.avg.toFixed(0)}% of attendance (${f.y}) to ${l.avg.toFixed(0)}% (${l.y}) — ${delta} points — so adult attendance is growing faster than kids'.`,
        tone: "neutral",
      });
    } else if (delta > 0) {
      insights.push({
        title: "Kids are a growing share of the room",
        detail: `Kids went from ${f.avg.toFixed(0)}% of attendance (${f.y}) to ${l.avg.toFixed(0)}% (${l.y}) — +${delta} points.`,
        tone: "up",
      });
    }
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
