"use client";

interface Row {
  fullName: string;
  pcoId: string;
  membershipType: string;
  status: string;
  flags: string;
  suggested: string;
  signals: string;
}

/** Download the currently-visible fit rows as a CSV worklist. Richer than the
 *  hygiene audit's two-column export because these rows are meant to be worked
 *  through in PCO one at a time — the person doing that needs to see *why* the
 *  row is here and where it should go, not just a name and a link. */
export function DownloadFitCsvButton({
  rows,
  filename,
}: {
  rows: Row[];
  filename: string;
}) {
  function handleClick() {
    const header = [
      "Name",
      "PCO link",
      "Current type",
      "Status",
      "Why flagged",
      "Suggested type",
      "Activity on record",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.fullName,
          `https://people.planningcenteronline.com/people/${r.pcoId}`,
          r.membershipType,
          r.status,
          r.flags,
          r.suggested,
          r.signals,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    // BOM so Excel opens the UTF-8 em dashes and names correctly.
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
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={rows.length === 0}
      className="px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed text-xs cursor-pointer"
      title="Download the currently visible rows as a CSV worklist"
    >
      ↓ CSV ({rows.length.toLocaleString()})
    </button>
  );
}

/** Quote a CSV cell when it contains commas, quotes, or newlines.
 *  RFC-4180-ish: wrap in quotes and double-up any embedded quotes. */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
