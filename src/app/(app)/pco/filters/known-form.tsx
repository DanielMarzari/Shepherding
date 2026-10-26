"use client";

import { useActionState, useState } from "react";
import {
  KNOWN_SIGNALS,
  SIGNAL_HELP,
  SIGNAL_LABEL,
  type KnownSignal,
} from "@/lib/classification";
import { saveKnownDefinitionAction, type FilterSaveState } from "./actions";

/** What defines being Known.
 *
 *  Shepherded and Unknown are measured; Known is whatever is left over. So
 *  this page is really the definition of Unknown, and the only two levers
 *  that matter are which signals count and how recently they have to have
 *  happened.
 *
 *  Editing the PCO record is not on the list and is not meant to be. It is
 *  activity ON a person by a staff member rather than BY them, and if it
 *  counted, an afternoon of data cleanup would promote hundreds of people
 *  into Known. The panel says so rather than leaving its absence looking
 *  like an oversight.
 */
export function KnownDefinitionForm({
  initialSignals,
  initialMin,
  activityMonths,
  isAdmin,
}: {
  initialSignals: KnownSignal[];
  initialMin: number;
  activityMonths: number;
  isAdmin: boolean;
}) {
  const [signals, setSignals] = useState<Set<string>>(new Set(initialSignals));
  const [min, setMin] = useState(initialMin);
  const [state, action, pending] = useActionState<FilterSaveState | null, FormData>(
    saveKnownDefinitionAction,
    null,
  );

  function toggle(id: string) {
    setSignals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={action}>
      <div className="px-5 py-4 border-b border-border-soft">
        <p className="text-sm text-muted leading-relaxed max-w-3xl">
          Everyone lands in one of three bands.{" "}
          <strong className="text-fg font-medium">Shepherded</strong> is
          measured — in a group or team where somebody is responsible for them.{" "}
          <strong className="text-fg font-medium">Unknown</strong> is measured
          here. <strong className="text-fg font-medium">Known</strong> is
          everyone else, so it needs no rule of its own.
        </p>
        <p className="text-sm text-muted leading-relaxed max-w-3xl mt-2">
          Tick what counts as this person doing something. Anyone with enough
          of it inside the window is Known; anyone without is Unknown.
        </p>
      </div>

      <ul className="divide-y divide-border-softer">
        {KNOWN_SIGNALS.map((sig) => {
          const on = signals.has(sig);
          return (
            <li
              key={sig}
              className={`px-5 py-3 transition-colors ${on ? "bg-accent-soft-bg/20" : ""}`}
            >
              <label
                className={`flex items-start gap-3 ${isAdmin ? "cursor-pointer" : ""}`}
              >
                <input
                  type="checkbox"
                  name="signal"
                  value={sig}
                  checked={on}
                  onChange={() => toggle(sig)}
                  disabled={!isAdmin}
                  className="accent-[var(--accent)] w-4 h-4 shrink-0 mt-0.5"
                />
                <span className="min-w-0">
                  <span className="font-medium block">
                    {SIGNAL_LABEL[sig as KnownSignal]}
                  </span>
                  <span className="text-xs text-muted leading-relaxed block mt-0.5">
                    {SIGNAL_HELP[sig as KnownSignal]}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="px-5 py-4 border-t border-border-soft bg-bg-elev">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="minSignals" className="text-sm">
            Needs at least
          </label>
          <select
            id="minSignals"
            name="minSignals"
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
            disabled={!isAdmin}
            className="bg-bg border border-border-soft rounded-md px-2.5 py-1.5 text-[13px] text-fg"
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="text-sm">
            different kind{min === 1 ? "" : "s"} of activity, within{" "}
            <strong>{activityMonths} months</strong>.
          </span>
        </div>
        <p className="text-xs text-muted mt-2 leading-relaxed max-w-3xl">
          Different <em>kinds</em>, not a count of events — three email opens
          and three gifts are not the same unit, and adding them together would
          mean nothing. The window is the org-wide activity window, changed
          under Sync settings so this definition and the lanes can never drift
          apart.
        </p>
      </div>

      <div className="px-5 py-4 border-t border-border-soft">
        <h3 className="text-xs uppercase tracking-wider text-subtle font-medium mb-2">
          Not on this list, deliberately
        </h3>
        <p className="text-sm text-muted leading-relaxed max-w-3xl">
          <strong className="text-fg font-medium">Edits to a PCO profile.</strong>{" "}
          That is activity on a person by a staff member, not by them. If it
          counted, an afternoon of record cleanup would quietly move hundreds
          of people into Known without any of them having done a thing.
        </p>
      </div>

      <div className="px-5 py-3 border-t border-border-soft flex items-center justify-between gap-4">
        <div className="text-xs">
          {state?.status === "saved" && (
            <span className="text-good-soft-fg">{state.message}</span>
          )}
          {state?.status === "error" && (
            <span className="text-bad-soft-fg">{state.message}</span>
          )}
          {!state && (
            <span className="text-muted">
              {signals.size === 0
                ? "Nothing ticked — saving falls back to counting everything rather than leaving Known empty."
                : `${signals.size} of ${KNOWN_SIGNALS.length} signals count. Takes effect on the next snapshot refresh.`}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!isAdmin || pending}
          className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Save definition"}
        </button>
      </div>
    </form>
  );
}
