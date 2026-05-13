"use client";

import { useActionState, useState } from "react";
import { saveCheckinEventsAction, type FilterSaveState } from "./actions";

interface Stat {
  eventId: string;
  name: string | null;
  frequency: string | null;
  archivedAt: string | null;
  totalCheckins: number;
  distinctPeople: number;
}

export function CheckinEventsForm({
  stats,
  initialShepherded,
  isAdmin,
}: {
  stats: Stat[];
  initialShepherded: string[];
  isAdmin: boolean;
}) {
  const [flagged, setFlagged] = useState<Set<string>>(
    new Set(initialShepherded),
  );
  const [state, action, pending] = useActionState<FilterSaveState | null, FormData>(
    saveCheckinEventsAction,
    null,
  );

  function toggle(id: string) {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={action}>
      <p className="px-5 py-3 text-xs text-muted border-b border-border-soft">
        Flag the kids / student / discipleship events where being checked-in means
        the person is being shepherded by name. Whoever does the check-in or
        check-out also bumps to Active automatically.
      </p>
      <ul className="divide-y divide-border-softer">
        {stats.map((s) => {
          const label = s.name ?? `(unnamed #${s.eventId})`;
          const isFlagged = flagged.has(s.eventId);
          const isArchived = !!s.archivedAt;
          return (
            <li
              key={s.eventId}
              className={`px-5 py-3.5 flex items-center justify-between gap-4 transition-colors ${
                isArchived
                  ? "opacity-60"
                  : isFlagged
                    ? "bg-good-soft-bg/20"
                    : ""
              }`}
            >
              <label
                className={`flex items-center gap-3 flex-1 ${
                  isAdmin ? "cursor-pointer" : ""
                }`}
              >
                <input
                  type="checkbox"
                  name="shepherded_checkin_event"
                  value={s.eventId}
                  checked={isFlagged}
                  onChange={() => toggle(s.eventId)}
                  disabled={!isAdmin}
                  className="accent-[var(--accent)] w-4 h-4"
                />
                <div>
                  <div className="font-medium">
                    {label}
                    {isArchived && (
                      <span className="ml-2 text-xs text-muted font-normal">
                        archived
                      </span>
                    )}
                    {s.frequency && (
                      <span className="ml-2 text-xs text-subtle font-normal">
                        {s.frequency}
                      </span>
                    )}
                  </div>
                </div>
              </label>
              <div className="flex items-center gap-3 text-xs text-muted shrink-0">
                <span className="tnum">
                  {s.totalCheckins.toLocaleString()} check-ins
                </span>
                <span className="tnum">
                  {s.distinctPeople.toLocaleString()} people
                </span>
                {isFlagged && (
                  <span className="text-good-soft-fg font-medium">shepherded</span>
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
              {flagged.size === 0
                ? "No events flagged — check-ins only bump Active right now."
                : `${flagged.size} event${flagged.size === 1 ? "" : "s"} flagged.`}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!isAdmin || pending}
          className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save check-in events"}
        </button>
      </div>
    </form>
  );
}
