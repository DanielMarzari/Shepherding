import "server-only";
import type { WeeklyAttendanceRow } from "./attendance-read";
import type { DayWeather } from "./weather-trexlertown";
import { parseLocalDate } from "./format-date";

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
  insights: SeasonalInsight[];
  baseline: number | null;
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
  // Map of Sunday → in-person attendance (skip null weeks).
  const att = new Map<string, number>();
  for (const r of rows) {
    if (r.in_person_total != null) att.set(r.week_date, r.in_person_total);
  }
  const allVals = [...att.values()].sort((a, b) => a - b);
  const insights: SeasonalInsight[] = [];
  const markers: SeasonalMarker[] = [];

  if (allVals.length < 8) {
    return { markers, insights, baseline: null };
  }

  // Baseline = median of all weeks (robust to holiday spikes).
  const baseline = allVals[Math.floor(allVals.length / 2)];

  const years = new Set<number>();
  for (const d of att.keys()) years.add(Number(d.slice(0, 4)));
  const sortedYears = [...years].sort();

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
      title: "Easter is the biggest Sunday",
      detail: `Easter averages ${Math.round(m).toLocaleString()} in person — about ${pct(m, baseline)}% above the typical week (${baseline.toLocaleString()}).`,
      tone: "up",
    });
  }
  if (postEasterVals.length >= 4) {
    const m = mean(postEasterVals);
    insights.push({
      title: "~10-week dip after Easter",
      detail: `In the 10 Sundays following Easter, attendance averages ${Math.round(m).toLocaleString()} — roughly ${Math.abs(pct(m, baseline))}% below the typical week before it climbs back.`,
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
      title: "Christmas Sundays spike",
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
        title: "Summer slump (Jun–Aug)",
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
        title: "Holiday weekends run light",
        detail: `Memorial Day, July 4th, Labor Day and Thanksgiving Sundays average ${Math.round(m).toLocaleString()} — about ${Math.abs(delta)}% below a typical week (people travel).`,
        tone: "down",
      });
    }
  }

  // ── Weather correlation ────────────────────────────────────────────
  const wTemps: number[] = [];
  const wAtt: number[] = [];
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
  if (corr != null && Math.abs(corr) >= 0.15) {
    insights.push({
      title:
        corr > 0
          ? "Warmer Sundays trend higher"
          : "Colder Sundays trend higher",
      detail: `Attendance and the day's high temperature correlate ${corr > 0 ? "positively" : "negatively"} (r = ${corr.toFixed(2)}) across ${wTemps.length} matched Sundays. ${
        corr > 0
          ? "Warm, pleasant Sundays draw more people."
          : "Counter-intuitively, colder Sundays see more people (likely winter/holiday season)."
      }`,
      tone: "neutral",
    });
  }
  if (rainy.length >= 4 && dry.length >= 4) {
    const rm = mean(rainy);
    const dm = mean(dry);
    const delta = pct(rm, dm);
    if (Math.abs(delta) >= 3) {
      insights.push({
        title: delta < 0 ? "Rain dampens turnout" : "Rainy Sundays hold up",
        detail: `Rainy Sundays (≥0.1in) average ${Math.round(rm).toLocaleString()} vs ${Math.round(dm).toLocaleString()} on dry Sundays — about ${Math.abs(delta)}% ${delta < 0 ? "lower" : "higher"}.`,
        tone: delta < 0 ? "down" : "neutral",
      });
    }
  }
  if (snowy.length >= 3 && noSnow.length >= 4) {
    const sm = mean(snowy);
    const nm = mean(noSnow);
    const delta = pct(sm, nm);
    insights.push({
      title: "Snowy Sundays cut attendance",
      detail: `On the ${snowy.length} Sundays with measurable snow, attendance averaged ${Math.round(sm).toLocaleString()} vs ${Math.round(nm).toLocaleString()} on snow-free Sundays — about ${Math.abs(delta)}% ${delta < 0 ? "lower" : "higher"}.`,
      tone: delta < 0 ? "down" : "neutral",
    });
  }
  if (cold.length >= 4 && mild.length >= 4) {
    const cm = mean(cold);
    const mm = mean(mild);
    const delta = pct(cm, mm);
    if (Math.abs(delta) >= 3) {
      insights.push({
        title: delta < 0 ? "Freezing Sundays run lighter" : "Freezing Sundays run heavier",
        detail: `Sub-freezing Sundays (high < 32°F) average ${Math.round(cm).toLocaleString()} vs ${Math.round(mm).toLocaleString()} on warmer days — about ${Math.abs(delta)}% ${delta < 0 ? "lower" : "higher"}.`,
        tone: delta < 0 ? "down" : "neutral",
      });
    }
  }

  return { markers, insights, baseline };
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
