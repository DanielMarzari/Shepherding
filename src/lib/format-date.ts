// Date helpers that treat a bare "YYYY-MM-DD" as a LOCAL calendar date,
// not UTC midnight. `new Date("2026-01-04")` parses as UTC midnight, so
// in any negative-UTC timezone it renders as the day before (Sunday →
// "Saturday"). Splitting the parts and using the Date(y, m-1, d) ctor
// keeps the calendar day — and weekday — correct. Plain module (no
// "server-only") so client charts can import it too.

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Parse "YYYY-MM-DD" into a local Date (no timezone shift). */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** "Sun, Jan 4, 2026" from a "YYYY-MM-DD" string, weekday correct. */
export function formatWeekDate(iso: string): string {
  const dt = parseLocalDate(iso);
  return `${WEEKDAYS[dt.getDay()].slice(0, 3)}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[parseLocalDate(iso).getDay()];
}
