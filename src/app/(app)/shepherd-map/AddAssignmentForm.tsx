"use client";

import { useState } from "react";
import {
  TARGET_KIND_LABELS,
  type TargetKind,
  type TargetOption,
} from "@/lib/assignments-types";
import { addAssignmentAction } from "./actions";

/** Inline form on each shepherd card. The target select depends on
 *  the selected kind, so this needs to be client-side state — but the
 *  options for all kinds are passed in pre-loaded so we don't fetch. */
export function AddAssignmentForm({
  shepherdPersonId,
  targetsByKind,
  excludePersonIds = [],
}: {
  shepherdPersonId: string;
  targetsByKind: Record<TargetKind, TargetOption[]>;
  /** Skip these IDs in the `person` picker — used to hide the shepherd
   *  themselves so they can't oversee themselves. */
  excludePersonIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TargetKind>("group");
  const [targetId, setTargetId] = useState("");

  const options =
    kind === "person"
      ? targetsByKind[kind].filter((o) => !excludePersonIds.includes(o.id))
      : targetsByKind[kind];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-accent hover:underline cursor-pointer"
      >
        + Add assignment
      </button>
    );
  }

  return (
    <form
      action={addAssignmentAction}
      onSubmit={() => {
        // Defer close so the action submit fires with our state values.
        setTimeout(() => {
          setOpen(false);
          setTargetId("");
        }, 0);
      }}
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      <input type="hidden" name="shepherdPersonId" value={shepherdPersonId} />
      <select
        name="targetKind"
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as TargetKind);
          setTargetId("");
        }}
        className="bg-bg-elev border border-border-soft rounded px-2 py-1 text-fg cursor-pointer"
      >
        {(Object.keys(TARGET_KIND_LABELS) as TargetKind[]).map((k) => (
          <option key={k} value={k}>
            {TARGET_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <select
        name="targetId"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        required
        className="bg-bg-elev border border-border-soft rounded px-2 py-1 text-fg cursor-pointer min-w-[14rem] max-w-[24rem]"
      >
        <option value="">— pick a {TARGET_KIND_LABELS[kind].toLowerCase()} —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <input
        type="text"
        name="note"
        placeholder="note (optional)"
        maxLength={500}
        className="bg-bg-elev border border-border-soft rounded px-2 py-1 text-fg placeholder:text-subtle flex-1 min-w-[8rem]"
      />
      <button
        type="submit"
        disabled={!targetId}
        className="px-2.5 py-1 rounded border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTargetId("");
        }}
        className="px-2.5 py-1 rounded border border-border-soft text-muted hover:text-fg cursor-pointer"
      >
        Cancel
      </button>
    </form>
  );
}
