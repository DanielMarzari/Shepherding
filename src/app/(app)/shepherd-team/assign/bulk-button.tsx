"use client";

import { useActionState } from "react";
import { autoAssignAction, bulkAssignAction, type AssignState } from "./actions";

/** Assign every uncontested person to the one shepherd who named them.
 *  Safe to press twice — anyone already assigned is excluded by the query,
 *  so a second run moves nobody rather than double-assigning. */
export function BulkAssignButton({
  count,
  isAdmin,
}: {
  count: number;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState<AssignState | null, FormData>(
    bulkAssignAction,
    null,
  );
  return (
    <form action={action} className="shrink-0 flex items-center gap-3">
      {state?.message && (
        <span
          className={`text-xs ${
            state.status === "error" ? "text-bad-soft-fg" : "text-good-soft-fg"
          }`}
        >
          {state.message}
        </span>
      )}
      <button
        type="submit"
        disabled={!isAdmin || pending || count === 0}
        className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Assigning…" : `Assign all ${count.toLocaleString()}`}
      </button>
    </form>
  );
}

/** The one bulk move for the pool.
 *
 *  Fills the emptiest shepherd first and stops at every bandwidth rather
 *  than overfilling — a maximum nobody enforces is decoration. Everyone has
 *  a bandwidth, their own or the team default, so nobody is skipped; the
 *  figure is the only thing holding this back, which is the argument for
 *  setting it before pressing the button.
 */
export function AutoAssignButton({
  count,
  isAdmin,
}: {
  count: number;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState<AssignState | null, FormData>(
    autoAssignAction,
    null,
  );
  return (
    <form
      action={action}
      className="rounded-lg border border-border-soft bg-bg-elev p-4 flex flex-wrap items-center gap-3"
    >
      <span className="text-[13px] text-muted flex-1 min-w-[260px] leading-relaxed">
        <strong className="text-fg">
          Auto-assign all {count.toLocaleString()}.
        </strong>{" "}
        Fills whoever has most room first, and stops at every bandwidth rather
        than overfilling. Anyone still on the team default is filled to that.
        You can change any of them afterwards.
      </span>
      {state?.message && (
        <span
          className={`text-xs ${
            state.status === "error" ? "text-bad-soft-fg" : "text-good-soft-fg"
          }`}
        >
          {state.message}
        </span>
      )}
      <button
        type="submit"
        disabled={!isAdmin || pending || count === 0}
        className="px-4 py-2 rounded bg-accent text-[var(--accent-fg)] text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Assigning…" : "Auto-assign all"}
      </button>
    </form>
  );
}
