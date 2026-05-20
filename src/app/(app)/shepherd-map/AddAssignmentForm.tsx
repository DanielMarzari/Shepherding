"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TARGET_KIND_HINTS,
  TARGET_KIND_LABELS,
  type TargetKind,
  type TargetOption,
} from "@/lib/assignments-types";
import { addAssignmentAction } from "./actions";

const KIND_ORDER: TargetKind[] = [
  "group",
  "group_type",
  "team",
  "service_type",
  "team_position",
  "membership_type",
  "reference_list",
  "shepherd_team",
  "person",
];

/** "+ Add assignment" trigger + modal. The modal is roomy on purpose:
 *  a 9-tile type picker, then a searchable multi-select checklist so an
 *  admin can wire up several targets in one pass. Saving creates one
 *  assignment row per ticked target. */
export function AddAssignmentForm({
  shepherdPersonId,
  shepherdName,
  targetsByKind,
  excludePersonIds = [],
}: {
  shepherdPersonId: string;
  shepherdName: string;
  targetsByKind: Record<TargetKind, TargetOption[]>;
  /** Skip these IDs in the `person` picker — hides the shepherd
   *  themselves so they can't oversee themselves. */
  excludePersonIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TargetKind>("group");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setOpen(false);
    setKind("group");
    setSelected(new Set());
    setQuery("");
  }

  function pickKind(k: TargetKind) {
    setKind(k);
    setSelected(new Set());
    setQuery("");
  }

  const options = useMemo(() => {
    const base =
      kind === "person"
        ? targetsByKind[kind].filter((o) => !excludePersonIds.includes(o.id))
        : targetsByKind[kind];
    const q = query.trim().toLowerCase();
    return q ? base.filter((o) => o.name.toLowerCase().includes(q)) : base;
  }, [kind, targetsByKind, excludePersonIds, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-accent hover:underline cursor-pointer"
      >
        + Add assignment
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[7vh] overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) reset();
          }}
        >
          <div className="w-full max-w-2xl rounded-xl bg-bg-elev border border-border-soft shadow-2xl flex flex-col max-h-[86vh]">
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border-soft shrink-0">
              <div>
                <h2 className="text-base font-semibold">Add assignment</h2>
                <p className="text-xs text-muted mt-0.5">
                  What does{" "}
                  <span className="text-fg font-medium">{shepherdName}</span>{" "}
                  oversee?
                </p>
              </div>
              <button
                type="button"
                onClick={reset}
                aria-label="Close"
                className="text-muted hover:text-fg cursor-pointer text-xl leading-none -mt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                ×
              </button>
            </div>

            <form
              action={addAssignmentAction}
              onSubmit={() => setTimeout(reset, 0)}
              className="flex flex-col min-h-0 flex-1"
            >
              <input
                type="hidden"
                name="shepherdPersonId"
                value={shepherdPersonId}
              />
              <input type="hidden" name="targetKind" value={kind} />
              {[...selected].map((id) => (
                <input key={id} type="hidden" name="targetId" value={id} />
              ))}

              <div className="px-6 py-4 overflow-y-auto space-y-5">
                {/* Step 1 — type */}
                <fieldset>
                  <legend className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                    1 · Connection type
                  </legend>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {KIND_ORDER.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => pickKind(k)}
                        aria-pressed={kind === k}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          kind === k
                            ? "border-accent bg-accent-soft-bg text-accent-soft-fg"
                            : "border-border-soft text-fg hover:border-accent"
                        }`}
                      >
                        {TARGET_KIND_LABELS[k]}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-subtle mt-2">
                    {TARGET_KIND_HINTS[kind]}
                  </p>
                </fieldset>

                {/* Step 2 — targets */}
                <fieldset className="min-h-0">
                  <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                    <legend className="text-xs font-semibold text-muted uppercase tracking-wider">
                      2 · Pick {TARGET_KIND_LABELS[kind].toLowerCase()}
                      {kind === "shepherd_team" ? "" : "s"}
                    </legend>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search…"
                      className="bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1 text-xs text-fg placeholder:text-subtle w-44 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>

                  <div className="rounded-lg border border-border-soft max-h-64 overflow-y-auto divide-y divide-border-softer">
                    {options.length === 0 ? (
                      <div className="px-3 py-8 text-center text-sm text-muted">
                        {query
                          ? `Nothing matches “${query}”.`
                          : "Nothing of this type synced yet."}
                      </div>
                    ) : (
                      options.map((o) => (
                        <label
                          key={o.id}
                          className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-bg-elev-2/60"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={() => toggle(o.id)}
                            className="cursor-pointer shrink-0"
                          />
                          <span className="text-sm truncate">{o.name}</span>
                        </label>
                      ))
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-2 text-xs">
                    <span className="text-muted tnum">
                      {selected.size.toLocaleString()} selected
                    </span>
                    {options.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (const o of options) next.add(o.id);
                            return next;
                          })
                        }
                        className="text-accent hover:underline cursor-pointer"
                      >
                        Select all shown
                      </button>
                    )}
                    {selected.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className="text-muted hover:text-fg cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </fieldset>

                {/* Note */}
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                    Note (optional)
                  </span>
                  <input
                    type="text"
                    name="note"
                    placeholder="e.g. interim — through the fall"
                    maxLength={500}
                    className="w-full bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <span className="text-[11px] text-subtle">
                    Applied to every assignment created in this batch.
                  </span>
                </label>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-soft shrink-0">
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg cursor-pointer text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={selected.size === 0}
                  className="px-3.5 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Save{" "}
                  {selected.size > 0 ? selected.size.toLocaleString() : ""}{" "}
                  assignment{selected.size === 1 ? "" : "s"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
