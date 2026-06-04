"use client";

import { useActionState } from "react";
import { geocodeBatchAction, type GeocodeState } from "./actions";

export function GeocodeButton({ pending }: { pending: number }) {
  const [state, action, running] = useActionState<GeocodeState | null, FormData>(
    () => geocodeBatchAction(),
    null,
  );
  return (
    <form action={action} className="flex items-center gap-3 flex-wrap">
      <button
        type="submit"
        disabled={running || pending === 0}
        className="px-3.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {running
          ? "Geocoding…"
          : pending === 0
            ? "All addresses geocoded"
            : `Geocode next ${Math.min(150, pending)}`}
      </button>
      {state?.message && (
        <span
          className={`text-xs ${
            state.status === "error" ? "text-warn-soft-fg" : "text-muted"
          }`}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
