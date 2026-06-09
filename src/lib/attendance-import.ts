import "server-only";
import * as XLSX from "xlsx";
import { getDb } from "./db";

/** Result of parsing one XLSX file. `imported` is the number of weeks
 *  successfully UPSERTed; `weeks` lists the dates touched (for the UI
 *  to show "I imported these Sundays"). */
export interface AttendanceImportResult {
  filename: string;
  imported: number;
  weeks: string[];
  warnings: string[];
}

/** Internal: one weekly row as we parse it before writing. */
interface WeeklyRow {
  week_date: string;
  in_person_total: number | null;
  kids_total: number | null;
  student_total: number | null;
  adult_total: number | null;
  center_total: number | null;
  chapel_total: number | null;
  online_live: number | null;
  online_on_demand: number | null;
  abfs: number | null;
  exception_reason: string | null;
}

// Label aliases — case-insensitive substring matching is too loose
// (e.g. "Kids Worship" appears as a category header AND a row), so we
// hard-code exact label sets per metric. Keep in lowercase.
type NumericMetric =
  | "in_person_total"
  | "kids_total"
  | "student_total"
  | "adult_total"
  | "center_total"
  | "chapel_total"
  | "online_live"
  | "online_on_demand"
  | "abfs";

const LABEL_ALIASES: Record<NumericMetric, string[]> = {
  in_person_total: [
    "total in-person worship",
    "total in person worship",
    "total all",
  ],
  kids_total: ["total kids worship"],
  student_total: ["total student worship", "total youth services"],
  adult_total: ["total adult worship", "total worship services"],
  center_total: ["center", "the center", "center worship", "total center worship"],
  chapel_total: ["chapel", "chapel worship", "total chapel worship"],
  online_live: [
    "sunday morning online live streaming",
    "sunday online live streaming",
  ],
  online_on_demand: ["totals"], // "TOTALS" row at bottom of Online section
  abfs: ["abfs"],
};

/** Excel serial dates count from 1900-01-01, but Excel mistakenly
 *  treats 1900 as a leap year, so day 60 (1900-02-29) shifts everything
 *  by 1 from 1900-03-01 onward. The +25569 offset accounts for the gap
 *  to the Unix epoch (1970-01-01). */
function excelSerialToISODate(n: number): string | null {
  if (!Number.isFinite(n) || n < 1) return null;
  const ms = (n - 25569) * 86_400_000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  // Pin to UTC midnight to avoid TZ drift sliding Sundays to Saturdays.
  return d.toISOString().slice(0, 10);
}

function toISODate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    )
      .toISOString()
      .slice(0, 10);
  }
  if (typeof value === "number") return excelSerialToISODate(value);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function toIntOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    // Sheets use "x" or "-" to mean "not run" — treat those as null,
    // NOT 0, so they don't drag averages down.
    if (!s || /^[x\-–—]+$/i.test(s)) return null;
    const n = Number(s.replace(/,/g, ""));
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function labelKey(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Free-text exception reason from a cell (e.g. "snow closure"). Blanks
 *  and the "x"/"-" not-run markers count as no exception. */
function toReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  if (!s || /^[x\-–—]+$/i.test(s)) return null;
  return s.slice(0, 200);
}

/** Scan rows for the first one whose middle cells are mostly dates —
 *  that's the date-header row. Returns the row index and an array of
 *  per-column ISO dates (or null when the column isn't a date). */
function findDateHeader(
  rows: unknown[][],
): { rowIdx: number; dates: (string | null)[] } | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const candidate = row.slice(1).map(toISODate);
    const dateCount = candidate.filter((d) => d !== null).length;
    if (dateCount >= 5) {
      // Pad back to original column alignment (col 0 = label, 1..N =
      // dates, then AVG/blanks).
      return { rowIdx: i, dates: [null, ...candidate] };
    }
  }
  return null;
}

/** Parse one workbook into weekly rows. Returns whatever could be
 *  salvaged — we ALWAYS produce a row per detected date, even if a
 *  specific category isn't found (those fields stay null). */
export function parseAttendanceWorkbook(
  buffer: ArrayBuffer | Buffer,
  filename: string,
): { rows: WeeklyRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  // Pick a sheet that looks like attendance: prefer "Attendance Summary"
  // / "Sunday Attendance" else first non-empty sheet.
  const preferred = wb.SheetNames.find((n) =>
    /attendance summary|sunday attendance/i.test(n),
  );
  const sheetName = preferred ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    warnings.push(`${filename}: no sheets`);
    return { rows: [], warnings };
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  });
  const header = findDateHeader(rows);
  if (!header) {
    warnings.push(`${filename}: couldn't find a row of weekly dates`);
    return { rows: [], warnings };
  }

  // Build initial weekly rows keyed by date.
  const byDate = new Map<string, WeeklyRow>();
  for (const d of header.dates) {
    if (!d) continue;
    if (!byDate.has(d)) {
      byDate.set(d, {
        week_date: d,
        in_person_total: null,
        kids_total: null,
        student_total: null,
        adult_total: null,
        center_total: null,
        chapel_total: null,
        online_live: null,
        online_on_demand: null,
        abfs: null,
        exception_reason: null,
      });
    }
  }

  // For each metric, find the FIRST matching row below the header and
  // assign its date-column values. "First match" wins so duplicate
  // "Totals" rows further down don't overwrite the right one.
  const metrics: NumericMetric[] = [
    "in_person_total",
    "kids_total",
    "student_total",
    "adult_total",
    "center_total",
    "chapel_total",
    "online_live",
    "online_on_demand",
    "abfs",
  ];

  for (const metric of metrics) {
    const aliases = LABEL_ALIASES[metric];
    let matchedRowIdx: number | null = null;
    for (let i = header.rowIdx + 1; i < rows.length; i++) {
      const label = labelKey(rows[i][0]);
      if (!label) continue;
      // "totals" is too generic — only treat it as online_on_demand if
      // we've already seen an online_live row above (proxy for "we're
      // in the online section now").
      if (metric === "online_on_demand") {
        if (label === "totals") {
          // Confirm we passed the online section by looking up at recent
          // labels.
          let sawOnline = false;
          for (let j = i - 1; j > header.rowIdx && j > i - 15; j--) {
            const back = labelKey(rows[j][0]);
            if (back.includes("online live streaming") || back.includes("on-demand")) {
              sawOnline = true;
              break;
            }
          }
          if (!sawOnline) continue;
        } else if (!aliases.includes(label)) {
          continue;
        }
      } else if (!aliases.includes(label)) {
        continue;
      }
      matchedRowIdx = i;
      break;
    }
    if (matchedRowIdx == null) continue;

    const row = rows[matchedRowIdx];
    for (let col = 1; col < header.dates.length; col++) {
      const d = header.dates[col];
      if (!d) continue;
      const v = toIntOrNull(row[col]);
      if (v == null) continue;
      const w = byDate.get(d);
      if (w) w[metric] = v;
    }
  }

  // Exceptions row — free-text reason per date ("snow closure", etc.)
  // that marks the week as excluded from averages. First match wins.
  for (let i = header.rowIdx + 1; i < rows.length; i++) {
    if (!labelKey(rows[i][0]).includes("exception")) continue;
    const row = rows[i];
    for (let col = 1; col < header.dates.length; col++) {
      const d = header.dates[col];
      if (!d) continue;
      const reason = toReason(row[col]);
      if (!reason) continue;
      const w = byDate.get(d);
      if (w) w.exception_reason = reason;
    }
    break;
  }

  // Drop weeks that have ZERO data for every metric (empty trailing
  // columns from spreadsheet padding) — but KEEP weeks flagged with an
  // exception even if the counts are blank (a closure still happened).
  const out: WeeklyRow[] = [];
  for (const w of byDate.values()) {
    const hasAny =
      w.in_person_total !== null ||
      w.kids_total !== null ||
      w.student_total !== null ||
      w.adult_total !== null ||
      w.center_total !== null ||
      w.chapel_total !== null ||
      w.online_live !== null ||
      w.online_on_demand !== null ||
      w.abfs !== null ||
      w.exception_reason !== null;
    if (hasAny) out.push(w);
  }
  out.sort((a, b) => a.week_date.localeCompare(b.week_date));
  if (out.length === 0) {
    warnings.push(`${filename}: parsed 0 weekly rows`);
  }
  return { rows: out, warnings };
}

/** Parse + upsert in one shot. Replaces any existing row for the same
 *  (org, week) so re-importing a corrected spreadsheet just overwrites. */
export function importAttendanceFile(
  orgId: number,
  filename: string,
  buffer: Buffer,
): AttendanceImportResult {
  const { rows, warnings } = parseAttendanceWorkbook(buffer, filename);
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO attendance_weekly
       (org_id, week_date, in_person_total, kids_total, student_total,
        adult_total, center_total, chapel_total, online_live, online_on_demand,
        abfs, exception_reason, source_file, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, week_date) DO UPDATE SET
       in_person_total = excluded.in_person_total,
       kids_total = excluded.kids_total,
       student_total = excluded.student_total,
       adult_total = excluded.adult_total,
       center_total = excluded.center_total,
       chapel_total = excluded.chapel_total,
       online_live = excluded.online_live,
       online_on_demand = excluded.online_on_demand,
       abfs = excluded.abfs,
       exception_reason = excluded.exception_reason,
       source_file = excluded.source_file,
       imported_at = excluded.imported_at`,
  );
  const tx = db.transaction((rs: WeeklyRow[]) => {
    for (const r of rs) {
      stmt.run(
        orgId,
        r.week_date,
        r.in_person_total,
        r.kids_total,
        r.student_total,
        r.adult_total,
        r.center_total,
        r.chapel_total,
        r.online_live,
        r.online_on_demand,
        r.abfs,
        r.exception_reason,
        filename,
      );
    }
  });
  tx(rows);
  return {
    filename,
    imported: rows.length,
    weeks: rows.map((r) => r.week_date),
    warnings,
  };
}
