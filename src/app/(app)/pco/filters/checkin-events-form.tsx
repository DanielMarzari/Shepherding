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

type Kind = "kid" | "adult" | "ignore";

export function CheckinEventsForm({
  stats,
  initialExcluded,
  initialAdult,
  isAdmin,
}: {
  stats: Stat[];
  initialExcluded: string[];
  initialAdult: string[];
  isAdmin: boolean;
}) {
  // Reconstruct the per-event kind. Default = kid; adult overrides
  // ignore (we store adult ids in both lists, but adult is the more
  // specific signal).
  const initialKinds = useMemo(() => {
    const m = new Map<string, Kind>();
    const adultSet = new Set(initialAdult);
    const excludedSet = new Set(initialExcluded);
    for (const id of excludedSet) {
      m.set(id, adultSet.has(id) ? "adult" : "ignore");
    }
    return m;
  }, [initialAdult, initialExcluded]);
  const [kinds, setKinds] = useState<Map<string, Kind>>(initialKinds);
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
  const counts = useMemo(() => {
    let kid = 0;
    let adult = 0;
    let ignore = 0;
    for (const s of stats) {
      if (s.archivedAt) continue;
      const k = kinds.get(s.eventId) ?? "kid";
      if (k === "kid") kid++;
      else if (k === "adult") adult++;
      else ignore++;
    }
    return { kid, adult, ignore };
  }, [stats, kinds]);

  function setKind(id: string, kind: Kind) {
    setKinds((prev) => {
      const next = new Map(prev);
      if (kind === "kid") next.delete(id);
      else next.set(id, kind);
      return next;
    });
  }

  return (
    <form action={action}>
      <div className="px-5 py-3 border-b border-border-soft flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-muted max-w-2xl">
          Tag each check-in event so the kid/shepherded math runs on the
          right ones. <span className="text-good-soft-fg">Kid</span> (default)
          counts toward Shepherded + implies minor for unknown-birthdate
          people. <span className="text-accent">Adult</span> excludes from
          Shepherded + implies adult (Office Visitors, adult Bible studies).
          <span className="text-warn-soft-fg"> Ignore</span> excludes
          without any age implication.
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
          const kind = kinds.get(s.eventId) ?? "kid";
          const isArchived = !!s.archivedAt;
          const rowTone =
            kind === "adult"
              ? "bg-accent-soft-bg/20"
              : kind === "ignore"
                ? "bg-warn-soft-bg/20"
                : "";
          return (
            <li
              key={s.eventId}
              className={`px-5 py-3.5 flex items-center justify-between gap-4 transition-colors ${
                isArchived ? "opacity-60" : rowTone
              }`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {s.name ?? `(unnamed #${s.eventId})`}
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
              </div>
              <div className="flex items-center gap-3 text-xs text-muted shrink-0 tnum">
                <span title="Last check-in">
                  {formatLastEvent(s.lastEventAt)}
                </span>
                <span title="Total check-in records (every scan, including anonymous visitors with no linked PCO person)">
                  {s.totalCheckins.toLocaleString()} scans
                </span>
                <span title="Distinct PCO people matched. Anonymous walk-ins (no linked person_id) aren't counted here.">
                  {s.distinctPeople.toLocaleString()} known people
                </span>
                <select
                  name={`checkin_event_kind[${s.eventId}]`}
                  value={kind}
                  onChange={(e) => setKind(s.eventId, e.target.value as Kind)}
                  disabled={!isAdmin}
                  className={`bg-bg-elev border border-border-soft rounded px-1.5 py-0.5 text-xs cursor-pointer focus:outline-none focus:border-accent ${
                    kind === "kid"
                      ? "text-good-soft-fg"
                      : kind === "adult"
                        ? "text-accent"
                        : "text-warn-soft-fg"
                  }`}
                >
                  <option value="kid">Kid event</option>
                  <option value="adult">Adult event</option>
                  <option value="ignore">Ignore</option>
                </select>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="px-5 py-3 border-t border-border-soft flex items-center justify-between">
        <div className="text-xs text-muted">
          {state?.status === "saved" && (
            <span className="text-good-soft-fg">{state.message}</span>
          )}
          {state?.status === "error" && (
            <span className="text-bad-soft-fg">{state.message}</span>
          )}
          {!state && (
            <>
              <span className="text-good-soft-fg">{counts.kid} kid</span>
              <span className="mx-1.5">·</span>
              <span className="text-accent">{counts.adult} adult</span>
              <span className="mx-1.5">·</span>
              <span className="text-warn-soft-fg">{counts.ignore} ignored</span>
            </>
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
