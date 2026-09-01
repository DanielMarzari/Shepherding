"use client";

import { useActionState } from "react";
import Link from "next/link";
import { type ImportCsvState, importPushpayCsvAction } from "./actions";

const INITIAL: ImportCsvState = { status: "idle" };

/** Drop the PushPay "All Donors" CSV export. Re-importing replaces the
 *  stored set (the engine DELETEs + re-inserts per org), so re-running a
 *  fresh export just refreshes everything and re-matches. */
export function PushpayImportForm() {
  const [state, action, pending] = useActionState(importPushpayCsvAction, INITIAL);
  const r = state.result;
  return (
    <form action={action} className="space-y-3" key={state.status}>
      <input
        type="file"
        name="file"
        accept=".csv"
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
          {pending ? "Importing…" : "Import giving"}
        </button>
        {state.status === "ok" && (
          <span className="text-xs text-good-soft-fg">{state.message}</span>
        )}
        {state.status === "error" && (
          <span className="text-xs text-warn-soft-fg">{state.message}</span>
        )}
      </div>

      {r && (
        <div className="rounded-lg border border-border-soft overflow-hidden">
          <div className="grid grid-cols-4 divide-x divide-border-softer text-center">
            <Stat label="Donors" value={r.total} tone="fg" />
            <Stat label="Matched" value={r.matched} tone="good" />
            <Stat label="To review" value={r.ambiguous} tone="warn" />
            <Stat label="Unmatched" value={r.unmatched} tone="muted" />
          </div>
          {(r.ambiguous > 0 || r.unmatched > 0) && (
            <Link
              href="/audit/pushpay"
              className="block border-t border-border-softer px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft-bg"
            >
              Review {(r.ambiguous + r.unmatched).toLocaleString()} donors that need a person →
            </Link>
          )}
        </div>
      )}
    </form>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "fg" | "good" | "warn" | "muted";
}) {
  const cls =
    tone === "good"
      ? "text-good-soft-fg"
      : tone === "warn"
        ? "text-warn-soft-fg"
        : tone === "muted"
          ? "text-muted"
          : "text-fg";
  return (
    <div className="px-2 py-3">
      <div className={`text-lg font-semibold tnum ${cls}`}>{value.toLocaleString()}</div>
      <div className="text-[11px] text-subtle mt-0.5">{label}</div>
    </div>
  );
}
