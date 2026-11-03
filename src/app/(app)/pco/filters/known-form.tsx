"use client";

import { useActionState, useState } from "react";
import {
  KNOWN_SIGNALS,
  SIGNAL_HELP,
  SIGNAL_LABEL,
  SIGNAL_MIN_DEFAULT,
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
  initialSignalMins,
  forms,
  activityMonths,
  isAdmin,
}: {
  initialSignals: KnownSignal[];
  initialMin: number;
  initialSignalMins: Record<KnownSignal, number>;
  /** Every form PCO knows about, with whether its submissions are synced. */
  forms: { id: string; name: string; active: boolean; tracked: boolean }[];
  activityMonths: number;
  isAdmin: boolean;
}) {
  const [signals, setSignals] = useState<Set<string>>(new Set(initialSignals));
  const [min, setMin] = useState(initialMin);
  const [mins, setMins] = useState<Record<string, number>>({
    ...SIGNAL_MIN_DEFAULT,
    ...initialSignalMins,
  });
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
              {/* The threshold sits on the signal it belongs to rather
                  than in a panel of its own: every signal has one now, and
                  a single shared box could only ever describe one. */}
              <span className="flex items-center gap-2 shrink-0 pl-7 sm:pl-0">
                <span className="text-xs text-muted">counts after</span>
                <input
                  type="number"
                  min={1}
                  name={`min_${sig}`}
                  value={mins[sig] ?? SIGNAL_MIN_DEFAULT[sig as KnownSignal]}
                  onChange={(e) =>
                    setMins((prev) => ({
                      ...prev,
                      [sig]: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  disabled={!isAdmin || !signals.has(sig)}
                  aria-label={`How many before ${SIGNAL_LABEL[sig as KnownSignal]} counts`}
                  className="w-[64px] bg-bg border border-border-soft rounded px-2 py-1 text-[13px] text-right tnum disabled:opacity-50"
                />
              </span>
            </li>
          );
        })}
      </ul>

      {/* Which forms produce a signal at all. A form that is not ticked is
          not synced, so submitting it leaves no trace anywhere — not in
          Known, and not in the inactive audit, where it showed up as
          people with a record and nothing against it. */}
      <div className="px-5 py-4 border-t border-border-soft">
        <h3 className="text-sm font-semibold">Forms that count</h3>
        <p className="text-xs text-muted mt-0.5 mb-3 leading-relaxed max-w-3xl">
          Only ticked forms have their submissions pulled from Planning
          Center. Anything unticked is invisible everywhere, however many
          people fill it in &mdash; so a connection card nobody ticked
          looks exactly like a person who has done nothing.
          {forms.length === 0 && (
            <>
              {" "}
              <strong className="text-fg">
                No forms have been catalogued yet
              </strong>{" "}
              &mdash; they are listed on the next PCO sync.
            </>
          )}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[280px] overflow-y-auto">
          {forms.map((f) => (
            <label
              key={f.id}
              className="flex items-center gap-2 text-[13px] rounded px-2 py-1 hover:bg-bg-elev-2 cursor-pointer"
            >
              <input
                type="checkbox"
                name="form"
                value={f.id}
                defaultChecked={f.tracked}
                disabled={!isAdmin}
                className="accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {!f.active && (
                <span className="text-[10px] text-subtle shrink-0">closed</span>
              )}
            </label>
          ))}
        </div>
      </div>

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
            different kind{min === 1 ? "" : "s"} of activity, each over its
            own bar above, within <strong>{activityMonths} months</strong>.
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
