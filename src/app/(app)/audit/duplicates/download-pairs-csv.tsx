"use client";

import { useState } from "react";
import { duplicatesCsvAction } from "./actions";

/** Export the currently-selected pairs as a CSV. The rows are fetched when
 *  the button is pressed rather than shipped with the page — there are 7,309
 *  of them, and almost nobody presses it. */
export function DownloadPairsCsv({
  confidence,
  returningOnly,
  count,
  filename,
}: {
  confidence: string | null;
  returningOnly: boolean;
  count: number;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const csv = await duplicatesCsvAction(confidence, returningOnly);
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || count === 0}
      className="text-xs text-accent hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? "Preparing…" : `Download ${count.toLocaleString()} as CSV`}
    </button>
  );
}
