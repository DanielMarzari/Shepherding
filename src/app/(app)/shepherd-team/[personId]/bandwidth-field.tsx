"use client";

import { useActionState } from "react";
import { saveOneBandwidthAction, type OversightState } from "./actions";

/** This shepherd's bandwidth, set here rather than on a list of 25.
 *  Everyone starts on the team default; clearing the field returns them to
 *  it rather than to nothing, and the label below says which they are on so
 *  a default is never mistaken for a decision. */
export function BandwidthField({
  shepherdPersonId,
  bandwidth,
  bandwidthSet,
  isAdmin,
}: {
  shepherdPersonId: string;
  bandwidth: number;
  bandwidthSet: boolean;
  isAdmin: boolean;
}) {
  const caption = bandwidthSet ? "bandwidth" : "bandwidth · default";
  const [state, action, pending] = useActionState<
    OversightState | null,
    FormData
  >(saveOneBandwidthAction, null);

  if (!isAdmin) {
    return (
      <div>
        <div className="text-2xl font-semibold tnum">
          {bandwidth.toLocaleString()}
        </div>
        <div className="text-[11px] text-subtle leading-snug">{caption}</div>
      </div>
    );
  }

  return (
    <form action={action}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          name="bandwidth"
          defaultValue={bandwidth}
          placeholder={String(bandwidth)}
          aria-label="Bandwidth — how many people this shepherd is responsible for"
          className="w-[86px] bg-bg border border-border-soft rounded px-2 py-1.5 text-[15px] text-right tnum focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <input type="hidden" name="shepherdPersonId" value={shepherdPersonId} />
        <button
          type="submit"
          disabled={pending}
          className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 cursor-pointer"
        >
          {pending ? "…" : "Save"}
        </button>
      </div>
      <div className="text-[11px] text-subtle leading-snug mt-1">
        {caption}
        {state?.message && (
          <span
            className={`ml-1.5 ${
              state.status === "error" ? "text-bad-soft-fg" : "text-good-soft-fg"
            }`}
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
