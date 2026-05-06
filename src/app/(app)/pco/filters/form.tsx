"use client";

import { useActionState, useState } from "react";
import { saveFiltersAction, type FilterSaveState } from "./actions";

interface Stat {
  membershipType: string | null;
  count: number;
}

export function FiltersForm({
  stats,
  initialExcluded,
  isAdmin,
}: {
  stats: Stat[];
  initialExcluded: string[];
  isAdmin: boolean;
}) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initialExcluded));
  const [state, action, pending] = useActionState<FilterSaveState | null, FormData>(
    saveFiltersAction,
    null,
  );

  function toggle(type: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <form action={action}>
      <ul className="divide-y divide-border-softer">
        {stats.map((s) => {
          const t = s.membershipType;
          const display = t ?? "(no type)";
          const isExcluded = !!t && excluded.has(t);
          return (
            <li
              key={display}
              className={`px-5 py-3.5 flex items-center justify-between gap-4 transition-colors ${
                t === null
                  ? "opacity-60"
                  : isExcluded
                    ? "bg-warn-soft-bg/20"
                    : ""
              }`}
            >
              <label
                className={`flex items-center gap-3 flex-1 ${
                  isAdmin && t !== null ? "cursor-pointer" : ""
                }`}
              >
                <input
                  type="checkbox"
                  name="exclude"
                  value={t ?? ""}
                  checked={isExcluded}
                  onChange={() => t && toggle(t)}
                  disabled={!isAdmin || t === null}
                  className="accent-[var(--accent)] w-4 h-4"
                />
                <div>
                  <div className="font-medium">{display}</div>
                  {t === null && (
                    <div className="text-xs text-muted">
                      Always included (people without a membership type are never excluded).
                    </div>
                  )}
                </div>
              </label>
              <div className="flex items-center gap-3 text-xs text-muted shrink-0">
                <span className="tnum">{s.count.toLocaleString()} people</span>
                {isExcluded && (
                  <span className="text-warn-soft-fg font-medium">excluded</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="px-5 py-3 border-t border-border-soft flex items-center justify-between">
        <div className="text-xs">
          {state?.status === "saved" && (
            <span className="text-good-soft-fg">{state.message}</span>
          )}
          {state?.status === "error" && (
            <span className="text-bad-soft-fg">{state.message}</span>
          )}
          {!state && (
            <span className="text-muted">
              {excluded.size === 0
                ? "No exclusions — everyone is included."
                : `${excluded.size} type${excluded.size === 1 ? "" : "s"} marked for exclusion.`}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!isAdmin || pending}
          className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save filters"}
        </button>
      </div>
    </form>
  );
}
