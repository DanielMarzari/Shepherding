"use client";

import { useActionState, useMemo, useState } from "react";
import { saveCheckinEventsAction, type FilterSaveState } from "./actions";
import { formatLastEvent } from "./filter-helpers";

interface Stat {
  eventId: string;
  name: string | null;
  frequency: string | null;
  archivedAt: string | null;
  totalCheckins: number;
  distinctPeople: number;
  lastEventAt: string | null;
}

export function CheckinEventsForm({
  stats,
  initialExcluded,
  isAdmin,
}: {
  stats: Stat[];
  initialExcluded: string[];
  isAdmin: boolean;
}) {
  const [excluded, setExcluded] = useState<Set<string>>(
    new Set(initialExcluded),
  );
  const [showArchived, setShowArchived] = useState(false);
  const [state, action, pending] = useActionState<FilterSaveState | null, FormData>(
    saveCheckinEventsAction,
    null,
  );

  const archivedCount = useMemo(
    () => stats.filter((s) => s.archivedAt).length,
    [stats],
  );
  const visible = useMemo(
    () => (showArchived ? stats : stats.filter((s) => !s.archivedAt)),
    [stats, showArchived],
  );

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={action}>
      <div className="px-5 py-3 border-b border-border-soft flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-muted max-w-2xl">
          <strong>Check the events to IGNORE.</strong> By default every check-in
          event is treated as a kids / student event — checking in there counts
          toward Shepherded once a person crosses the cadence threshold on
          /metrics, and a person without a birthdate gets flipped to
          &ldquo;minor&rdquo;. Use this list to pull out the non-kid events
          (Office Visitors, Volunteer sign-ups, adult Bible studies, etc.).
        </p>
        {archivedCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-[var(--accent)] w-3.5 h-3.5"
            />
            Show {archivedCount} archived
          </label>
        )}
      </div>
      <ul className="divide-y divide-border-softer">
        {visible.map((s) => {
          const label = s.name ?? `(unnamed #${s.eventId})`;
          const isExcluded = excluded.has(s.eventId);
          const isArchived = !!s.archivedAt;
          return (
            <li
              key={s.eventId}
              className={`px-5 py-3.5 flex items-center justify-between gap-4 transition-colors ${
                isArchived
                  ? "opacity-60"
                  : isExcluded
                    ? "bg-warn-soft-bg/20"
                    : ""
              }`}
            >
              <label
                className={`flex items-center gap-3 flex-1 min-w-0 ${
                  isAdmin ? "cursor-pointer" : ""
                }`}
              >
                <input
                  type="checkbox"
                  name="excluded_checkin_event"
                  value={s.eventId}
                  checked={isExcluded}
                  onChange={() => toggle(s.eventId)}
                  disabled={!isAdmin}
                  className="accent-[var(--accent)] w-4 h-4 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-medium truncate">
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
              <div className="flex items-center gap-3 text-xs text-muted shrink-0 tnum">
                <span title="Last check-in">
                  {formatLastEvent(s.lastEventAt)}
                </span>
                <span>{s.totalCheckins.toLocaleString()} check-ins</span>
                <span>{s.distinctPeople.toLocaleString()} people</span>
                {isExcluded ? (
                  <span className="text-warn-soft-fg font-medium">ignored</span>
                ) : (
                  <span className="text-good-soft-fg font-medium">kid event</span>
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
                ? "Every check-in event counts as a kid event."
                : `Ignoring ${excluded.size} event${excluded.size === 1 ? "" : "s"} — the rest count as kid events.`}
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
