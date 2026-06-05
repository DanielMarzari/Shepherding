"use client";

import { useActionState, useState } from "react";
import { type FilterSaveState, saveMapRadiusAction } from "./actions";

export function MapRadiusForm({
  initialHours,
  isAdmin,
}: {
  initialHours: number;
  isAdmin: boolean;
}) {
  const [hours, setHours] = useState(String(initialHours));
  const [state, action, pending] = useActionState<FilterSaveState | null, FormData>(
    saveMapRadiusAction,
    null,
  );
  return (
    <form action={action} className="p-5 space-y-3">
      <div>
        <label htmlFor="hours" className="text-xs text-muted block mb-1.5">
          Max distance from Faith Church (hours)
        </label>
        <div className="flex items-center gap-3">
          <input
            id="hours"
            name="hours"
            type="number"
            min={0.5}
            max={24}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            disabled={!isAdmin}
            className="bg-bg-elev-2 border border-border-soft rounded px-3 py-2 text-sm w-28 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          />
          <span className="text-xs text-muted">hours (driving)</span>
        </div>
        <p className="text-xs text-subtle mt-1.5 max-w-prose">
          Homes farther than this from Faith Church are excluded from the
          second-campus siting on the Member map — they&apos;re likely
          out-of-area and shouldn&apos;t pull a campus toward them.
        </p>
      </div>
      {state?.status === "saved" && (
        <p className="text-xs text-good-soft-fg">{state.message}</p>
      )}
      {state?.status === "error" && (
        <p className="text-xs text-warn-soft-fg">{state.message}</p>
      )}
      {isAdmin && (
        <button
          type="submit"
          disabled={pending}
          className="px-3.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 cursor-pointer"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      )}
    </form>
  );
}
