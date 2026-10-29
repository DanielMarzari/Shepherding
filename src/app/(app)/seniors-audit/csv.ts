/** Serialize rows to CSV and hand the browser a file.
 *
 *  Per-tab rather than one export for the page: each tab answers a
 *  different question and its columns are the answer, so a single
 *  lowest-common-denominator export would be the one thing nobody wants.
 *  The data is already in the browser — nothing round-trips.
 */
export function downloadCsv(
  filename: string,
  header: string[],
  rows: (string | number | null)[][],
): void {
  const lines = [header.map(cell).join(",")];
  for (const r of rows) lines.push(r.map(cell).join(","));
  // The BOM is what makes Excel read UTF-8 rather than mangling accents in
  // somebody's name, which is the whole point of exporting a person list.
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

function cell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // A leading =, +, - or @ makes a spreadsheet treat the value as a
  // formula. Prefixing a quote keeps a name like "-Smith" a name.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
