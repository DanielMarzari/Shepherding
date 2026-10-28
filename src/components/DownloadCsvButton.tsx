"use client";

interface Row {
  pcoId: string;
  fullName: string;
}

/** Download the currently-visible audit rows as a two-column CSV
 *  (name + PCO profile URL). The data is already on the page — we just
 *  serialize and trigger a download client-side, no server roundtrip. */
export function DownloadCsvButton({
  rows,
  filename,
}: {
  rows: Row[];
  filename: string;
}) {
  function handleClick() {
    const lines = ["Name,PCO link"];
    for (const r of rows) {
      const url = `https://people.planningcenteronline.com/people/${r.pcoId}`;
      lines.push(`${csvCell(r.fullName)},${csvCell(url)}`);
    }
    const blob = new Blob([lines.join("\n")], {
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
      title="Download the currently visible rows as a CSV"
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
