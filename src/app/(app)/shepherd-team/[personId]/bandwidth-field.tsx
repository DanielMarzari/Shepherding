"use client";

import { useActionState } from "react";
import { saveOneBandwidthAction, type OversightState } from "./actions";

/** This shepherd's bandwidth, set here rather than on a list of 25.
 *  Blank means unset, which is not the same as nought: an unset bandwidth
 *  is left out of the team total instead of silently reading as zero. */
export function BandwidthField({
  shepherdPersonId,
  bandwidth,
  isAdmin,
}: {
  shepherdPersonId: string;
  bandwidth: number | null;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState<
    OversightState | null,
    FormData
  >(saveOneBandwidthAction, null);

  if (!isAdmin) {
    return (
      <div>
        <div className="text-2xl font-semibold tnum">
          {bandwidth === null ? (
            <span className="text-subtle text-base">not set</span>
          ) : (
            bandwidth.toLocaleString()
          )}
        </div>
        <div className="text-[11px] text-subtle leading-snug">bandwidth</div>
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
          defaultValue={bandwidth ?? ""}
          placeholder="not set"
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
        bandwidth
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
