// Not every note in the spreadsheet's "Exceptions" column is a real
// reason to drop a Sunday from the averages. Closures / cancellations /
// weather events ARE (the count is unrepresentative). Informational
// notes like "chapel includes overflow" or "Easter" are NOT — those
// weeks should stay in the averages. Plain module (no "server-only") so
// both the read/analysis layers and the client charts can share it.

const EXCLUDING = new RegExp(
  [
    "snow",
    "sleet",
    "\\bice\\b",
    "icy",
    "storm",
    "blizzard",
    "hurricane",
    "weather",
    "closed",
    "closure",
    "cancel", // cancel / canceled / cancelled / cancellation
    "no service",
    "no services",
    "did ?n'?t meet",
    "did not meet",
    "outage",
    "power out",
    "covid",
    "pandemic",
    "quarantine",
    "flood",
  ].join("|"),
  "i",
);

/** True only when an exception reason is a genuine reason to EXCLUDE the
 *  week from averages/trends (closure, cancellation, severe weather).
 *  Informational notes ("chapel includes overflow", "Easter", …) return
 *  false so the week stays counted. */
export function isExcludingReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return EXCLUDING.test(reason);
}

const HOLIDAY = new RegExp(
  [
    "easter",
    "good friday",
    "palm sunday",
    "christmas",
    "thanksgiving",
    "new year",
    "holy week",
    "holiday",
    "mother'?s day",
    "father'?s day",
  ].join("|"),
  "i",
);

/** True when an exception note names a holiday (Easter, Christmas, …). These
 *  weeks still count toward averages (they're not exclusions) but are worth
 *  marking on charts, since they swing attendance. */
export function isHolidayReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return HOLIDAY.test(reason);
}

export type ExceptionKind = "cancel" | "holiday" | "note";
export interface AttendanceMarker {
  week_date: string;
  reason: string;
  kind: ExceptionKind;
}

/** Classify a week's exception note for chart markers: cancellation
 *  (excluded), holiday, or a plain informational note. */
export function classifyException(reason: string | null | undefined): ExceptionKind | null {
  if (!reason || !reason.trim()) return null;
  if (isExcludingReason(reason)) return "cancel";
  if (isHolidayReason(reason)) return "holiday";
  return "note";
}
