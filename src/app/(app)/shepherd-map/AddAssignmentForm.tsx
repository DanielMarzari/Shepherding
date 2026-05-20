"use client";

import { useEffect, useState } from "react";
import {
  TARGET_KIND_LABELS,
  type TargetKind,
  type TargetOption,
} from "@/lib/assignments-types";
import { addAssignmentAction } from "./actions";

const KIND_HINTS: Record<TargetKind, string> = {
  group: "Oversees a single group.",
  group_type: "Oversees every group of this type.",
  team: "Oversees a single serving team.",
  service_type: "Oversees every team under this service type.",
  team_position: "Oversees everyone holding this position on a team.",
  person: "Oversees another shepherd (peer hierarchy).",
};

/** "+ Add assignment" trigger + modal. A modal (rather than an inline
 *  row) so the full target list is comfortable to scan — the picker
 *  options can run long. The target select depends on the chosen kind,
 *  so this is client state; the options for all kinds are passed in
 *  pre-loaded so nothing is fetched here. */
export function AddAssignmentForm({
  shepherdPersonId,
  shepherdName,
  targetsByKind,
  excludePersonIds = [],
}: {
  shepherdPersonId: string;
  shepherdName: string;
  targetsByKind: Record<TargetKind, TargetOption[]>;
  /** Skip these IDs in the `person` picker — used to hide the shepherd
   *  themselves so they can't oversee themselves. */
  excludePersonIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TargetKind>("group");
  const [targetId, setTargetId] = useState("");

  // Close on Escape while the modal is open.
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
    setTargetId("");
  }

  const options =
    kind === "person"
      ? targetsByKind[kind].filter((o) => !excludePersonIds.includes(o.id))
      : targetsByKind[kind];

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
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh] overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) reset();
          }}
        >
          <div className="w-full max-w-md rounded-[10px] bg-bg-elev border border-border-soft shadow-xl">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border-soft">
              <div>
                <h2 className="text-sm font-semibold">Add assignment</h2>
                <p className="text-xs text-muted mt-0.5">{shepherdName}</p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="text-muted hover:text-fg cursor-pointer text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              action={addAssignmentAction}
              onSubmit={() => {
                // Defer close so the action submits with current state.
                setTimeout(reset, 0);
              }}
              className="px-5 py-4 space-y-4 text-sm"
            >
              <input
                type="hidden"
                name="shepherdPersonId"
                value={shepherdPersonId}
              />

              <label className="block space-y-1">
                <span className="text-xs text-muted">Type</span>
                <select
                  name="targetKind"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as TargetKind);
                    setTargetId("");
                  }}
                  className="w-full bg-bg-elev-2 border border-border-soft rounded px-2 py-1.5 text-fg cursor-pointer"
                >
                  {(Object.keys(TARGET_KIND_LABELS) as TargetKind[]).map((k) => (
                    <option key={k} value={k}>
                      {TARGET_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-subtle">
                  {KIND_HINTS[kind]}
                </span>
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-muted">
                  {TARGET_KIND_LABELS[kind]}{" "}
                  <span className="text-subtle">
                    ({options.length.toLocaleString()})
                  </span>
                </span>
                <select
                  name="targetId"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  required
                  size={8}
                  className="w-full bg-bg-elev-2 border border-border-soft rounded px-1 py-1 text-fg cursor-pointer"
                >
                  {options.length === 0 && (
                    <option value="" disabled>
                      Nothing of this type synced yet
                    </option>
                  )}
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-muted">Note (optional)</span>
                <input
                  type="text"
                  name="note"
                  placeholder="e.g. interim — through the fall"
                  maxLength={500}
                  className="w-full bg-bg-elev-2 border border-border-soft rounded px-2 py-1.5 text-fg placeholder:text-subtle"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-1.5 rounded border border-border-soft text-muted hover:text-fg cursor-pointer text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!targetId}
                  className="px-3 py-1.5 rounded border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-xs"
                >
                  Save assignment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
