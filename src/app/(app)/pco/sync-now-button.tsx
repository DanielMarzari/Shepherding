"use client";

import { useActionState } from "react";
import { type SyncNowState, syncNowAction } from "./actions";

export function SyncNowButton() {
  const [state, action, pending] = useActionState<SyncNowState | null, FormData>(
    syncNowAction,
    null,
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={pending ? "animate-spin" : ""}
        >
          <path d="M3 12a9 9 0 0 1 15.5-6.3M21 4v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.5 6.3M3 20v-5h5" />
        </svg>
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {state?.status === "ok" && (
        <span className="text-xs text-good-soft-fg">{state.message}</span>
      )}
      {state?.status === "error" && (
        <span className="text-xs text-bad-soft-fg">{state.message}</span>
      )}
    </form>
  );
}
