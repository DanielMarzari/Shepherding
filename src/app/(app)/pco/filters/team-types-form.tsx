"use client";

import { useActionState, useMemo, useState } from "react";
import { saveTeamTypeFiltersAction, type FilterSaveState } from "./actions";
import { formatLastEvent } from "./filter-helpers";

interface Stat {
  serviceTypeId: string | null;
  name: string | null;
  teams: number;
  members: number;
  archivedAt: string | null;
  lastEventAt: string | null;
}

interface PositionStat {
  serviceTypeId: string | null;
  positionId: string;
  positionName: string | null;
  teamName: string | null;
  members: number;
}

export function TeamTypeFiltersForm({
  stats,
  initialExcluded,
  isAdmin,
  positionStats,
  initialExcludedPositions,
}: {
  stats: Stat[];
  initialExcluded: string[];
  isAdmin: boolean;
  positionStats: PositionStat[];
  initialExcludedPositions: string[];
}) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initialExcluded));
  const [excludedPositions, setExcludedPositions] = useState<Set<string>>(
    new Set(initialExcludedPositions),
  );
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState<FilterSaveState | null, FormData>(
    saveTeamTypeFiltersAction,
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
  // Group positions by their service_type for fast lookup per row.
  const positionsByType = useMemo(() => {
    const map = new Map<string, PositionStat[]>();
    for (const p of positionStats) {
      const key = p.serviceTypeId ?? "__null__";
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [positionStats]);

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePosition(id: string) {
    setExcludedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={action}>
      {archivedCount > 0 && (
        <div className="px-5 py-2 border-b border-border-soft flex items-center justify-end">
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-[var(--accent)] w-3.5 h-3.5"
            />
            Show {archivedCount} archived
          </label>
        </div>
      )}
      <ul className="divide-y divide-border-softer">
        {visible.map((s) => {
          const id = s.serviceTypeId;
          const label = s.name ?? "(no service type)";
          const isExcluded = !!id && excluded.has(id);
          const isArchived = !!s.archivedAt;
          const positions = positionsByType.get(id ?? "__null__") ?? [];
          const isOpen = !!id && expanded.has(id);
          const excludedHere = positions.filter((p) =>
            excludedPositions.has(p.positionId),
          ).length;
          return (
            <li
              key={id ?? label}
              className={`transition-colors ${
                id === null || isArchived
                  ? "opacity-60"
                  : isExcluded
                    ? "bg-warn-soft-bg/20"
                    : ""
              }`}
            >
              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <label
                  className={`flex items-center gap-3 flex-1 min-w-0 ${
                    isAdmin && id !== null ? "cursor-pointer" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    name="exclude_team_type"
                    value={id ?? ""}
                    checked={isExcluded}
                    onChange={() => id && toggle(id)}
                    disabled={!isAdmin || id === null}
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
                    </div>
                    {id === null && (
                      <div className="text-xs text-muted">
                        Always included (teams without a service type are never excluded).
                      </div>
                    )}
                  </div>
                </label>
                <div className="flex items-center gap-3 text-xs text-muted shrink-0 tnum">
                  <span title="Last plan in this service type">
                    {formatLastEvent(s.lastEventAt)}
                  </span>
                  <span>{s.teams.toLocaleString()} teams</span>
                  <span>{s.members.toLocaleString()} members</span>
                  {excludedHere > 0 && (
                    <span className="text-warn-soft-fg font-medium">
                      −{excludedHere} pos
                    </span>
                  )}
                  {isExcluded && (
                    <span className="text-warn-soft-fg font-medium">excluded</span>
                  )}
                  {positions.length > 0 && id !== null && !isExcluded && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(id)}
                      className="text-accent hover:underline cursor-pointer"
                    >
                      {isOpen ? "hide positions" : `${positions.length} positions`}
                    </button>
                  )}
                </div>
              </div>

              {isOpen && positions.length > 0 && !isExcluded && (
                <ul className="bg-bg-elev/40 border-t border-border-softer divide-y divide-border-softer/60">
                  {positions.map((p) => {
                    const isPosExcluded = excludedPositions.has(p.positionId);
                    return (
                      <li
                        key={p.positionId}
                        className={`pl-12 pr-5 py-2 flex items-center justify-between gap-3 text-xs ${
                          isPosExcluded ? "bg-warn-soft-bg/30" : ""
                        }`}
                      >
                        <label
                          className={`flex items-center gap-2 flex-1 min-w-0 ${
                            isAdmin ? "cursor-pointer" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            name="exclude_team_position"
                            value={p.positionId}
                            checked={isPosExcluded}
                            onChange={() => togglePosition(p.positionId)}
                            disabled={!isAdmin}
                            className="accent-[var(--accent)] w-3.5 h-3.5 shrink-0"
                          />
                          <span className="truncate">
                            <span className="font-medium text-fg">
                              {p.positionName ?? "(unnamed position)"}
                            </span>
                            {p.teamName && (
                              <span className="text-muted ml-2">
                                · {p.teamName}
                              </span>
                            )}
                          </span>
                        </label>
                        <span className="text-muted tnum shrink-0">
                          {p.members.toLocaleString()} ppl
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
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
              {excluded.size === 0 && excludedPositions.size === 0
                ? "All service types + positions count toward Serve."
                : `${excluded.size} type${excluded.size === 1 ? "" : "s"} · ${excludedPositions.size} position${excludedPositions.size === 1 ? "" : "s"} excluded.`}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!isAdmin || pending}
          className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save team filters"}
        </button>
      </div>
    </form>
  );
}
