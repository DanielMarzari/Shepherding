"use client";

import { useActionState, useState } from "react";
import { saveShepherdedDefinitionAction, type FilterSaveState } from "./actions";

/** What defines being Shepherded.
 *
 *  Known had a page and Shepherded did not, which made the larger band
 *  the invisible one. Three things put somebody here, and only the third
 *  has a number attached — the one that decides that a child checked in
 *  often enough is somebody's responsibility even though the child has
 *  done nothing that counts toward Known. That is deliberate: the adult
 *  who brings them needs two categories of their own, the child needs
 *  only to be brought.
 */
export function ShepherdedDefinitionForm({
  initialMinEvents,
  windowMonths,
  isAdmin,
}: {
  initialMinEvents: number;
  windowMonths: number;
  isAdmin: boolean;
}) {
  const [minEvents, setMinEvents] = useState(initialMinEvents);
  const [state, action, pending] = useActionState<FilterSaveState | null, FormData>(
    saveShepherdedDefinitionAction,
    null,
  );

  return (
    <form action={action}>
      <div className="px-5 py-4 border-b border-border-soft">
        <p className="text-sm text-muted leading-relaxed max-w-3xl">
          Shepherded means somebody is responsible for this person. It is
          measured, not configured per signal the way Known is &mdash; there
          are exactly three ways in, and two of them are rosters.
        </p>
      </div>

      <ul className="divide-y divide-border-softer">
        <Path
          n={1}
          title="In a group"
          body="An active membership of a group whose type is not excluded below. The group's leader is the person responsible."
        />
        <Path
          n={2}
          title="On a team"
          body="An active place on a team roster whose service type and position are not excluded below. The team's leader is the person responsible."
        />
        <Path
          n={3}
          title="Checked in as a dependent"
          body="Enough check-ins to a non-excluded event, where either the person is already a minor or somebody else did the checking in. A child brought week after week is somebody's responsibility even though the child has done nothing that counts toward Known — the adult who brings them is the one who needs two categories of their own."
        />
      </ul>

      <div className="px-5 py-4 border-t border-border-soft bg-bg-elev">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="checkinMin" className="text-sm">
            A dependent is shepherded after
          </label>
          <input
            id="checkinMin"
            type="number"
            name="checkinMin"
            min={1}
            max={52}
            value={minEvents}
            onChange={(e) => setMinEvents(Math.max(1, Number(e.target.value) || 1))}
            disabled={!isAdmin}
            className="w-[72px] bg-bg border border-border-soft rounded px-2 py-1.5 text-[13px] text-right tnum disabled:opacity-50"
          />
          <span className="text-sm">
            check-in{minEvents === 1 ? "" : "s"}, within{" "}
            <strong>{windowMonths} months</strong>.
          </span>
          {isAdmin && (
            <button
              type="submit"
              disabled={pending}
              className="px-3.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 cursor-pointer"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          )}
          {state?.message && (
            <span
              className={`text-xs ${
                state.status === "error" ? "text-bad-soft-fg" : "text-good-soft-fg"
              }`}
            >
              {state.message}
            </span>
          )}
        </div>
        <p className="text-xs text-muted mt-2 leading-relaxed max-w-3xl">
          Which events count is the check-in list further down this page —
          every event is treated as a kids event unless it is excluded there.
          Raising this number moves children out of Shepherded and into
          Unknown rather than into Known: a child who is brought does not
          thereby do anything themselves.
        </p>
      </div>
    </form>
  );
}

function Path({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="px-5 py-3 flex gap-4">
      <span className="w-7 h-7 rounded-full bg-bg-elev-2 flex items-center justify-center text-xs font-semibold shrink-0">
        {n}
      </span>
      <span className="min-w-0">
        <span className="text-[13px] font-medium block">{title}</span>
        <span className="text-xs text-muted leading-relaxed block mt-0.5">
          {body}
        </span>
      </span>
    </li>
  );
}
