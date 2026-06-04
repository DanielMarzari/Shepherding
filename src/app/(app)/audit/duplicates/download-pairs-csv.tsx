"use client";

import type { DuplicatePairView } from "@/lib/audit-read";

const PCO = "https://people.planningcenteronline.com/people/";

/** Export the currently-selected duplicate pairs as a CSV — one row per
 *  pair, with both names + PCO links, confidence, the returning flag, and
 *  the match reasons. The count in the label tracks the filtered set. */
export function DownloadPairsCsv({
  pairs,
  filename,
}: {
  pairs: DuplicatePairView[];
  filename: string;
}) {
  function handleClick() {
    const lines = [
      "Person A,A link,Person B,B link,Confidence,Possibly returning,Reasons",
    ];
    for (const p of pairs) {
      lines.push(
        [
          csvCell(p.a.fullName),
          csvCell(`${PCO}${p.a.pcoId}`),
          csvCell(p.b.fullName),
          csvCell(`${PCO}${p.b.pcoId}`),
          p.confidence,
          p.oneActiveOneInactive ? "yes" : "no",
          csvCell(p.reasons.join(" | ")),
        ].join(","),
      );
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
      disabled={pairs.length === 0}
      className="px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed text-xs cursor-pointer"
      title="Download the currently selected pairs as a CSV"
    >
      ↓ CSV ({pairs.length.toLocaleString()})
    </button>
  );
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
