import "server-only";
import type { WeeklyAttendanceRow } from "./attendance-read";
import type { DayWeather } from "./weather-trexlertown";
import { parseLocalDate, formatWeekDate } from "./format-date";
import { isExcludingReason } from "./attendance-exclusion";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface SeasonalMarker {
  date: string;
  kind: "easter" | "christmas";
  label: string;
}
export interface SeasonalInsight {
  title: string;
  detail: string;
  tone: "up" | "down" | "neutral";
}
export interface SeasonalAnalysis {
  markers: SeasonalMarker[];
  /** Non-weather patterns (year-over-year, holidays, months, online) —
   *  shown under the first chart. */
  seasonalInsights: SeasonalInsight[];
  /** Weather patterns (temperature hi/lo, rain, snow, cancellations) —
   *  shown under the weather chart. */
  weatherInsights: SeasonalInsight[];
  baseline: number | null;
  /** Avg %/year change over the last ~5 qualifying years. */
  yearlyGrowthPct: number | null;
  /** Mean weekly in-person attendance (non-excluded weeks). */
  weeklyMean: number | null;
  /** Std deviation of weekly in-person attendance — the normal ± swing. */
  weeklyStdDev: number | null;
}

/** Anonymous Gregorian computus → Easter Sunday "YYYY-MM-DD". */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso: string, n: number): string {
  const dt = parseLocalDate(iso);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function pct(part: number, base: number): number {
  return Math.round(((part - base) / base) * 100);
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

/** Detect seasonal + weather patterns in weekly IN-PERSON attendance.
 *  Returns chart markers/bands plus a list of human-readable insights. */
export function analyzeSeasonalTrends(
  rows: WeeklyAttendanceRow[],
  weather: Map<string, DayWeather>,
): SeasonalAnalysis {
  // Map of Sunday → in-person attendance (skip null weeks and weeks
  // flagged as exceptions — snow closures, cancellations — so they
  // don't pollute the trend math).
  const att = new Map<string, number>();
  for (const r of rows) {
    if (isExcludingReason(r.exception_reason)) continue;
    if (r.in_person_total != null) att.set(r.week_date, r.in_person_total);
  }
  const allVals = [...att.values()].sort((a, b) => a - b);
  const insights: SeasonalInsight[] = []; // non-weather → first chart
  const weatherInsights: SeasonalInsight[] = []; // weather → second chart
  const markers: SeasonalMarker[] = [];
  let yearlyGrowthPct: number | null = null;

  if (allVals.length < 8) {
    return {
      markers,
      seasonalInsights: insights,
      weatherInsights,
      baseline: null,
      yearlyGrowthPct: null,
      weeklyMean: null,
      weeklyStdDev: null,
    };
  }

  // Baseline = median of all weeks (robust to holiday spikes).
  const baseline = allVals[Math.floor(allVals.length / 2)];
  // Mean + standard deviation = the "normal" week-to-week swing.
  const weeklyMean = mean(allVals);
  const weeklyStdDev = Math.sqrt(
    mean(allVals.map((v) => (v - weeklyMean) ** 2)),
  );

  const years = new Set<number>();
  for (const d of att.keys()) years.add(Number(d.slice(0, 4)));
  const sortedYears = [...years].sort();

  // ── Year-over-year trend ───────────────────────────────────────────
  const byYear = new Map<number, number[]>();
  for (const [d, v] of att) {
    const y = Number(d.slice(0, 4));
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(v);
  }
  // Only count years with enough Sundays to be representative.
  const yearAvgs = [...byYear.entries()]
    .filter(([, vals]) => vals.length >= 10)
    .map(([y, vals]) => ({ y, avg: mean(vals) }))
    .sort((a, b) => a.y - b.y);
  if (yearAvgs.length >= 2) {
    const recent = yearAvgs.slice(-5); // 5-year trend
    const first = recent[0];
    const last = recent[recent.length - 1];
    const span = last.y - first.y;
    const totalPct = pct(last.avg, first.avg);
    const perYear = span > 0 ? Math.round(totalPct / span) : totalPct;
    yearlyGrowthPct = perYear;
    insights.push({
      title:
        perYear > 0
          ? "Attendance is growing year over year"
          : perYear < 0
            ? "Attendance is declining year over year"
            : "Attendance is flat year over year",
      detail: `Average in-person attendance went from ${Math.round(first.avg).toLocaleString()} (${first.y}) to ${Math.round(last.avg).toLocaleString()} (${last.y}) — about ${perYear >= 0 ? "+" : ""}${perYear}% per year.`,
      tone: perYear > 0 ? "up" : perYear < 0 ? "down" : "neutral",
    });
  }

  // ── Biggest Sundays ────────────────────────────────────────────────
  const topSundays = [...att.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (topSundays.length >= 1) {
    insights.push({
      title: "Your biggest Sundays",
      detail: topSundays
        .map(([d, v]) => `${formatWeekDate(d)} (${v.toLocaleString()})`)
        .join("; "),
      tone: "up",
    });
  }

  // ── Strongest / weakest month ──────────────────────────────────────
  const byMonth = new Map<string, number[]>();
  for (const [d, v] of att) {
    const mm = d.slice(5, 7);
    if (!byMonth.has(mm)) byMonth.set(mm, []);
    byMonth.get(mm)!.push(v);
  }
  const monthAvgs = [...byMonth.entries()]
    .filter(([, vals]) => vals.length >= 3)
    .map(([mm, vals]) => ({ mm, avg: mean(vals) }))
    .sort((a, b) => b.avg - a.avg);
  if (monthAvgs.length >= 3) {
    const hi = monthAvgs[0];
    const lo = monthAvgs[monthAvgs.length - 1];
    const monthName = (mm: string) => MONTH_NAMES[Number(mm) - 1] ?? mm;
    insights.push({
      title: "Strongest and weakest months",
      detail: `${monthName(hi.mm)} is the highest-attendance month (avg ${Math.round(hi.avg).toLocaleString()}); ${monthName(lo.mm)} is the lowest (avg ${Math.round(lo.avg).toLocaleString()}).`,
      tone: "neutral",
    });
  }

  // ── Easter peak + post-Easter dip + markers/bands ──────────────────
  const easterVals: number[] = [];
  const postEasterVals: number[] = [];
  for (const y of sortedYears) {
    const e = easterSunday(y);
    if (att.has(e)) {
      easterVals.push(att.get(e)!);
      markers.push({ date: e, kind: "easter", label: `Easter ${y}` });
    }
    // 10 Sundays after Easter.
    const windowVals: number[] = [];
    for (let w = 1; w <= 10; w++) {
      const d = addDays(e, 7 * w);
      if (att.has(d)) windowVals.push(att.get(d)!);
    }
    if (windowVals.length >= 4) {
      postEasterVals.push(...windowVals);
    }
  }
  if (easterVals.length > 0) {
    const m = mean(easterVals);
    insights.push({
      title: "Easter has the highest attendance",
      detail: `Easter averages ${Math.round(m).toLocaleString()} in person — about ${pct(m, baseline)}% above the typical week (${baseline.toLocaleString()}).`,
      tone: "up",
    });
  }
  if (postEasterVals.length >= 4) {
    const m = mean(postEasterVals);
    insights.push({
      title: "Attendance drops for ~10 weeks after Easter",
      detail: `In the 10 Sundays following Easter, attendance averages ${Math.round(m).toLocaleString()} — about ${Math.abs(pct(m, baseline))}% below the typical week before it recovers.`,
      tone: "down",
    });
  }

  // ── Christmas peak + markers ───────────────────────────────────────
  const christmasVals: number[] = [];
  for (const d of att.keys()) {
    const md = d.slice(5); // MM-DD
    if (md >= "12-20" && md <= "12-27") {
      christmasVals.push(att.get(d)!);
      markers.push({
        date: d,
        kind: "christmas",
        label: `Christmas ${d.slice(0, 4)}`,
      });
    }
  }
  if (christmasVals.length > 0) {
    const m = mean(christmasVals);
    insights.push({
      title: "Christmas Sundays have higher attendance",
      detail: `Sundays around Christmas average ${Math.round(m).toLocaleString()} — about ${pct(m, baseline)}% above a typical week.`,
      tone: "up",
    });
  }

  // ── Summer slump (Jun–Aug vs rest) + bands ─────────────────────────
  const summer: number[] = [];
  const nonSummer: number[] = [];
  for (const [d, v] of att) {
    const mm = d.slice(5, 7);
    if (mm === "06" || mm === "07" || mm === "08") summer.push(v);
    else nonSummer.push(v);
  }
  if (summer.length >= 4 && nonSummer.length >= 4) {
    const sm = mean(summer);
    const nm = mean(nonSummer);
    const delta = pct(sm, nm);
    if (delta <= -3) {
      insights.push({
        title: "Summer attendance is lower (Jun–Aug)",
        detail: `Summer Sundays average ${Math.round(sm).toLocaleString()} vs ${Math.round(nm).toLocaleString()} the rest of the year — about ${Math.abs(delta)}% lower.`,
        tone: "down",
      });
    }
  }

  // ── Holiday-weekend lows (Memorial / July 4 / Labor / Thanksgiving) ─
  const holidayLows: number[] = [];
  for (const y of sortedYears) {
    for (const hd of holidayWeekendSundays(y)) {
      if (att.has(hd)) holidayLows.push(att.get(hd)!);
    }
  }
  if (holidayLows.length >= 3) {
    const m = mean(holidayLows);
    const delta = pct(m, baseline);
    if (delta <= -3) {
      insights.push({
        title: "Holiday weekends have lower attendance",
        detail: `Memorial Day, July 4th, Labor Day and Thanksgiving Sundays average ${Math.round(m).toLocaleString()} — about ${Math.abs(delta)}% below a typical week.`,
        tone: "down",
      });
    }
  }

  // ── Online vs in-person (substitution?) ────────────────────────────
  const ip: number[] = [];
  const onl: number[] = [];
  for (const r of rows) {
    if (isExcludingReason(r.exception_reason)) continue;
    if (r.in_person_total != null && r.online_live != null) {
      ip.push(r.in_person_total);
      onl.push(r.online_live);
    }
  }
  const onlineCorr = pearson(onl, ip);
  if (onlineCorr != null && ip.length >= 8) {
    insights.push({
      title:
        onlineCorr < -0.15
          ? "Online viewing rises when in-person dips"
          : onlineCorr > 0.15
            ? "Online and in-person rise together"
            : "Online viewing is independent of in-person",
      detail: `In-person and online-live attendance correlate ${onlineCorr > 0 ? "positively" : "negatively"} (r = ${onlineCorr.toFixed(2)}) across ${ip.length} weeks${onlineCorr < -0.15 ? " — some people watch online on the weeks they can't make it in person." : "."}`,
      tone: "neutral",
    });
  }

  // ── Weather correlation ────────────────────────────────────────────
  const wTemps: number[] = [];
  const wAtt: number[] = [];
  const wLowTemps: number[] = [];
  const wLowAtt: number[] = [];
  const rainy: number[] = [];
  const dry: number[] = [];
  const snowy: number[] = [];
  const noSnow: number[] = [];
  const cold: number[] = [];
  const mild: number[] = [];
  for (const [d, v] of att) {
    const w = weather.get(d);
    if (!w) continue;
    if (w.tmaxF != null) {
      wTemps.push(w.tmaxF);
      wAtt.push(v);
      if (w.tmaxF < 32) cold.push(v);
      else mild.push(v);
    }
    if (w.tminF != null) {
      wLowTemps.push(w.tminF);
      wLowAtt.push(v);
    }
    const rain = w.rainIn ?? w.precipIn;
    if (rain != null) {
      if (rain >= 0.1) rainy.push(v);
      else dry.push(v);
    }
    if (w.snowIn != null) {
      if (w.snowIn >= 0.25) snowy.push(v);
      else noSnow.push(v);
    }
  }
  const corr = pearson(wTemps, wAtt);
  if (corr != null && wTemps.length >= 8) {
    const r2 = corr * corr;
    const explained = Math.round(r2 * 100);
    weatherInsights.push({
      title:
        Math.abs(corr) < 0.15
          ? "Daytime high barely affects attendance"
          : corr > 0
            ? "Warmer Sundays have higher attendance"
            : "Colder Sundays have higher attendance",
      detail: `Attendance and the day's high temperature correlate ${corr > 0 ? "positively" : "negatively"} (r = ${corr.toFixed(2)}), so the high accounts for about ${explained}% of the week-to-week variation (R² = ${r2.toFixed(2)}) across ${wTemps.length} matched Sundays.`,
      tone: "neutral",
    });
  }
  const corrLow = pearson(wLowTemps, wLowAtt);
  if (corrLow != null && wLowTemps.length >= 8) {
    const r2 = corrLow * corrLow;
    const explained = Math.round(r2 * 100);
    weatherInsights.push({
      title:
        Math.abs(corrLow) < 0.15
          ? "Overnight low barely affects attendance"
          : corrLow > 0
            ? "Milder overnight lows have higher attendance"
            : "Colder overnight lows have higher attendance",
      detail: `Attendance and the overnight low correlate ${corrLow > 0 ? "positively" : "negatively"} (r = ${corrLow.toFixed(2)}), accounting for about ${explained}% of the variation (R² = ${r2.toFixed(2)}) across ${wLowTemps.length} matched Sundays.`,
      tone: "neutral",
    });
  }
  if (rainy.length >= 4 && dry.length >= 4) {
    const rm = mean(rainy);
    const dm = mean(dry);
    const delta = pct(rm, dm);
    if (Math.abs(delta) >= 3) {
      weatherInsights.push({
        title: delta < 0 ? "Rain lowers attendance" : "Rain raises attendance",
        detail: `Rainy Sundays (≥0.1in) average ${Math.round(rm).toLocaleString()} vs ${Math.round(dm).toLocaleString()} on dry Sundays — about ${Math.abs(delta)}% ${delta < 0 ? "lower" : "higher"}.`,
        tone: delta < 0 ? "down" : "neutral",
      });
    }
  }
  if (snowy.length >= 3 && noSnow.length >= 4) {
    const sm = mean(snowy);
    const nm = mean(noSnow);
    const delta = pct(sm, nm);
    weatherInsights.push({
      title: delta < 0 ? "Snow lowers attendance" : "Snow raises attendance",
      detail: `On the ${snowy.length} Sundays with measurable snow, attendance averaged ${Math.round(sm).toLocaleString()} vs ${Math.round(nm).toLocaleString()} on snow-free Sundays — about ${Math.abs(delta)}% ${delta < 0 ? "lower" : "higher"}.`,
      tone: delta < 0 ? "down" : "neutral",
    });
  }
  if (cold.length >= 4 && mild.length >= 4) {
    const cm = mean(cold);
    const mm = mean(mild);
    const delta = pct(cm, mm);
    if (Math.abs(delta) >= 3) {
      weatherInsights.push({
        title: delta < 0 ? "Cold lowers attendance" : "Cold raises attendance",
        detail: `Sub-freezing Sundays (high < 32°F) average ${Math.round(cm).toLocaleString()} vs ${Math.round(mm).toLocaleString()} on warmer days — about ${Math.abs(delta)}% ${delta < 0 ? "lower" : "higher"}.`,
        tone: delta < 0 ? "down" : "neutral",
      });
    }
  }
  // Weather cancellations — the most extreme weather effect (attendance
  // dropped to ~0 / the service didn't happen), so they're excluded from
  // the correlations above; surface the count so weather isn't understated.
  const WEATHER_CANCEL = /\b(snow|sleet|ice|icy|storm|blizzard|weather|freez|wind|hurricane|flood)\b/i;
  let weatherCancels = 0;
  for (const r of rows) {
    if (r.exception_reason && WEATHER_CANCEL.test(r.exception_reason)) weatherCancels++;
  }
  if (weatherCancels > 0) {
    weatherInsights.push({
      title: "Weather has forced full cancellations",
      detail: `${weatherCancels} Sunday${weatherCancels === 1 ? "" : "s"} ${weatherCancels === 1 ? "was" : "were"} cancelled or closed for weather (excluded from the averages) — the most extreme weather effect, so the temperature correlations above understate weather's true impact.`,
      tone: "down",
    });
  }

  return {
    markers,
    baseline,
    seasonalInsights: insights,
    weatherInsights,
    yearlyGrowthPct,
    weeklyMean,
    weeklyStdDev,
  };
}

/** Sundays adjacent to the big travel holidays for a given year. */
function holidayWeekendSundays(year: number): string[] {
  const out: string[] = [];
  // Memorial Day = last Monday of May → the Sunday before.
  out.push(addDays(lastWeekdayOfMonth(year, 4, 1), -1));
  // Labor Day = first Monday of Sep → the Sunday before.
  out.push(addDays(firstWeekdayOfMonth(year, 8, 1), -1));
  // Thanksgiving = 4th Thursday of Nov → the Sunday after.
  out.push(addDays(nthWeekdayOfMonth(year, 10, 4, 4), 3));
  // July 4th → the nearest Sunday.
  const jul4 = new Date(year, 6, 4);
  const offset = -jul4.getDay(); // back to the Sunday of that week
  out.push(addDays(`${year}-07-04`, offset));
  return out;
}
function firstWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const d = new Date(year, month, 1);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const d = new Date(year, month + 1, 0); // last day of month
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): string {
  const d = new Date(year, month, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) {
      count++;
      if (count === nth) break;
    }
    d.setDate(d.getDate() + 1);
  }
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
