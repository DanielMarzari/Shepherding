import type { AttendanceMarker } from "./attendance-exclusion";

const DAY = 86_400_000;

/** Easter Sunday (Gregorian) for a year — anonymous computus. Returns a UTC
 *  date; Easter is always a Sunday. */
export function easterSunday(year: number): Date {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Easter (✝) and Christmas (★) markers for every year covered by the given
 *  Sunday week-dates — computed from the calendar, not the spreadsheet notes,
 *  so they're marked every year. Each is snapped to the nearest service Sunday
 *  in the data (Easter is exact; Christmas to the Sunday of its week). */
export function holidayMarkersForWeeks(weekDates: string[]): AttendanceMarker[] {
  if (weekDates.length === 0) return [];
  const out: AttendanceMarker[] = [];
  const years = new Set(weekDates.map((w) => Number(w.slice(0, 4))));
  const snap = (target: Date, tolDays: number): string | null => {
    let best: string | null = null;
    let bestDiff = Infinity;
    for (const w of weekDates) {
      const diff = Math.abs(new Date(w).valueOf() - target.valueOf());
      if (diff < bestDiff) { bestDiff = diff; best = w; }
    }
    return best != null && bestDiff <= tolDays * DAY ? best : null;
  };
  for (const y of years) {
    const e = snap(easterSunday(y), 3);
    if (e) out.push({ week_date: e, reason: `Easter ${y}`, kind: "easter" });
    const c = snap(new Date(Date.UTC(y, 11, 25)), 6);
    if (c) out.push({ week_date: c, reason: `Christmas ${y}`, kind: "christmas" });
  }
  return out;
}
