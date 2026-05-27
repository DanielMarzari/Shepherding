"use client";

import { useActionState } from "react";
import {
  type ImportXlsxState,
  importAttendanceXlsxAction,
} from "./actions";

const INITIAL: ImportXlsxState = { status: "idle" };

/** Multi-file XLSX upload. Re-importing the same file is fine — the
 *  parser UPSERTs by (org, week_date), so corrections overwrite. */
export function AttendanceUploadForm() {
  const [state, action, pending] = useActionState(
    importAttendanceXlsxAction,
    INITIAL,
  );
  return (
    <form
      action={action}
      className="space-y-3"
      // Reset the file input between uploads so the same file can be
      // re-dropped after a corrections pass without a manual clear.
      key={state.status}
    >
      <input
        type="file"
        name="files"
        accept=".xlsx"
        multiple
        required
        disabled={pending}
        className="block text-sm text-fg file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-accent file:bg-transparent file:text-accent file:text-xs file:font-medium file:cursor-pointer hover:file:bg-accent hover:file:text-bg"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium cursor-pointer"
        >
          {pending ? "Importing…" : "Import"}
        </button>
        {state.status === "ok" && (
          <span className="text-xs text-good-soft-fg">{state.message}</span>
        )}
        {state.status === "error" && (
          <span className="text-xs text-warn-soft-fg">{state.message}</span>
        )}
      </div>
      {state.results && state.results.length > 0 && (
        <ul className="text-xs text-muted divide-y divide-border-softer rounded-lg border border-border-soft">
          {state.results.map((r, i) => (
            <li key={`${r.filename}-${i}`} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-fg truncate">
                  {r.filename}
                </span>
                <span
                  className={
                    r.imported > 0
                      ? "text-good-soft-fg tnum shrink-0"
                      : "text-warn-soft-fg tnum shrink-0"
                  }
                >
                  {r.imported.toLocaleString()} week
                  {r.imported === 1 ? "" : "s"}
                </span>
              </div>
              {r.warnings.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {r.warnings.map((w, j) => (
                    <li
                      key={j}
                      className="text-[11px] text-warn-soft-fg break-words"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
