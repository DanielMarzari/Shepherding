"use client";

import { useMemo, useState } from "react";
import { Avatar, Pill } from "@/components/ui";
import type { CareCandidate } from "@/lib/care-read";
import { addCareAssignmentsAction } from "./actions";

interface ShepherdOption {
  personId: string;
  fullName: string;
}

/** The interactive half of the care map: search the unassigned pool,
 *  tick the people to cover, pick a shepherd, assign in one shot.
 *
 *  Selection is held in React state (not raw checkbox inputs) so a
 *  search that unmounts a row doesn't silently drop it. The actual
 *  form payload is a hidden `personId` input per selected id. */
export function CareAssignPanel({
  candidates,
  shepherds,
}: {
  candidates: CareCandidate[];
  shepherds: ShepherdOption[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shepherdId, setShepherdId] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.fullName.toLowerCase().includes(q));
  }, [candidates, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) next.add(c.personId);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted">
        Everyone in scope already has a carer. 🎉 Nothing to assign.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search names…"
          className="bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-sm text-fg placeholder:text-subtle flex-1 min-w-[12rem]"
        />
        <span className="text-xs text-muted tnum">
          {selected.size.toLocaleString()} selected · {filtered.length}{" "}
          shown
        </span>
        <button
          type="button"
          onClick={selectAllFiltered}
          className="text-xs text-accent hover:underline cursor-pointer"
        >
          Select all shown
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-muted hover:text-fg cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      <ul className="max-h-[420px] overflow-y-auto rounded border border-border-soft divide-y divide-border-softer">
        {filtered.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-muted">
            No names match &ldquo;{query}&rdquo;.
          </li>
        ) : (
          filtered.map((c) => (
            <li key={c.personId}>
              <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-bg-elev-2/60">
                <input
                  type="checkbox"
                  checked={selected.has(c.personId)}
                  onChange={() => toggle(c.personId)}
                  className="cursor-pointer"
                />
                <Avatar initials={c.initials} size="sm" />
                <span className="font-medium text-sm truncate flex-1">
                  {c.fullName}
                </span>
                <Pill tone={c.classification === "active" ? "good" : "muted"}>
                  {c.classification}
                </Pill>
                {c.isMinor && <Pill tone="warn">kid</Pill>}
                <span className="text-xs text-muted hidden sm:inline">
                  {c.membershipType ?? "—"}
                </span>
              </label>
            </li>
          ))
        )}
      </ul>

      <form
        action={addCareAssignmentsAction}
        onSubmit={() => {
          // Clear selection after the action picks up the payload.
          setTimeout(() => setSelected(new Set()), 0);
        }}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="personId" value={id} />
        ))}
        <span className="text-xs text-muted">Assign to</span>
        <select
          name="shepherdPersonId"
          value={shepherdId}
          onChange={(e) => setShepherdId(e.target.value)}
          required
          className="bg-bg-elev-2 border border-border-soft rounded px-2 py-1.5 text-fg cursor-pointer"
        >
          <option value="">— pick a shepherd —</option>
          {shepherds.map((s) => (
            <option key={s.personId} value={s.personId}>
              {s.fullName}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="note"
          placeholder="note (optional)"
          maxLength={500}
          className="bg-bg-elev-2 border border-border-soft rounded px-2 py-1.5 text-fg placeholder:text-subtle flex-1 min-w-[8rem]"
        />
        <button
          type="submit"
          disabled={selected.size === 0 || !shepherdId}
          className="px-3 py-1.5 rounded border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-xs"
        >
          Assign {selected.size > 0 ? selected.size.toLocaleString() : ""}{" "}
          {selected.size === 1 ? "person" : "people"}
        </button>
      </form>
    </div>
  );
}
