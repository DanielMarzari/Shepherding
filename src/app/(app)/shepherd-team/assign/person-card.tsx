"use client";

import { useActionState, useState } from "react";
import type { CandidatePerson, ShepherdRow } from "@/lib/shepherd-assign";
import { assignOneAction, type AssignState } from "./actions";

/** One card, used by both the contested page and the pool.
 *
 *  The only difference between them is which shepherds appear as choices —
 *  the people who named this person, or whoever still has room. Keeping it
 *  one component means both pages feel identical to work through, which
 *  matters when somebody is about to do it four thousand times.
 */
export function PersonCard({
  people,
  shepherds,
  heading,
  source,
  emptyTitle,
  emptyBody,
}: {
  people: CandidatePerson[];
  shepherds: ShepherdRow[];
  heading: string;
  source: "contested" | "manual";
  emptyTitle: string;
  emptyBody: string;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState<AssignState | null, FormData>(
    assignOneAction,
    null,
  );

  const queue = people.filter((p) => !done.has(p.personId));
  const person = queue[Math.min(index, queue.length - 1)];

  if (!person) {
    return (
      <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-14 text-center">
        <h2 className="text-lg font-semibold">{emptyTitle}</h2>
        <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
          {emptyBody}
        </p>
      </div>
    );
  }

  const byName = new Map(shepherds.map((s) => [s.name, s]));
  const options =
    source === "contested"
      ? person.claimedBy
          .map((n) => byName.get(n))
          .filter((s): s is ShepherdRow => !!s)
      : shepherds
          .filter((s) => s.bandwidth !== null && s.bandwidth - s.byRole - s.assigned > 0)
          .sort(
            (a, b) =>
              (b.bandwidth ?? 0) - b.byRole - b.assigned -
              ((a.bandwidth ?? 0) - a.byRole - a.assigned),
          )
          .slice(0, 8);

  function advance(personId: string) {
    setDone((prev) => new Set(prev).add(personId));
    setIndex(0);
  }

  const total = people.length;
  const position = total - queue.length + 1;

  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev p-7 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <span className="text-[11px] text-subtle tnum">
          {position.toLocaleString()} of {total.toLocaleString()}
        </span>
        <div className="flex-1 mx-4 h-1 rounded-full bg-bg-elev-2 overflow-hidden">
          <div
            style={{ width: `${(position / Math.max(total, 1)) * 100}%` }}
            className="h-full bg-accent"
          />
        </div>
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          className="text-[11px] text-subtle hover:text-fg"
        >
          Skip &rarr;
        </button>
      </div>

      <div className="text-center mb-5">
        <div
          aria-hidden="true"
          className="w-14 h-14 rounded-full bg-bg-elev-2 border border-border-soft mx-auto flex items-center justify-center text-base font-semibold text-muted"
        >
          {person.name
            .split(/\s+/)
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <h2 className="text-xl font-semibold mt-2.5">{person.name}</h2>
        <p className="text-[13px] text-subtle mt-1">{person.context}</p>
      </div>

      {state?.status === "error" && (
        <p className="text-xs text-bad-soft-fg text-center mb-3">{state.message}</p>
      )}

      <div className="text-[11px] uppercase tracking-wider text-subtle mb-2 text-center">
        {heading}
      </div>

      {options.length === 0 ? (
        <p className="text-sm text-muted text-center py-6 leading-relaxed">
          Nobody has room. Set a bandwidth on the{" "}
          <a href="/shepherd-team/assign" className="text-accent hover:underline">
            assignment page
          </a>{" "}
          first — people are only placed against a bandwidth somebody has
          agreed to.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {options.map((s) => {
            const used = s.byRole + s.assigned;
            const room = s.bandwidth === null ? null : s.bandwidth - used;
            const pct =
              s.bandwidth === null
                ? 100
                : Math.min(100, (used / Math.max(s.bandwidth, 1)) * 100);
            return (
              <form key={s.personId} action={action}>
                <input type="hidden" name="personId" value={person.personId} />
                <input type="hidden" name="shepherdId" value={s.personId} />
                <input type="hidden" name="source" value={source} />
                <button
                  type="submit"
                  disabled={pending}
                  onClick={() => advance(person.personId)}
                  className="w-full rounded-lg border border-border-soft bg-bg p-3 text-left hover:border-accent hover:bg-accent-soft-bg/30 transition-colors disabled:opacity-50"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="w-8 h-8 rounded-full bg-bg-elev-2 flex items-center justify-center text-[10px] font-semibold text-muted shrink-0"
                    >
                      {s.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-[13px] truncate">
                        {s.name}
                      </span>
                      <span
                        className={`block text-[11px] tnum ${
                          room === null
                            ? "text-subtle"
                            : room <= 0
                              ? "text-bad-soft-fg"
                              : room < 10
                                ? "text-warn-soft-fg"
                                : "text-subtle"
                        }`}
                      >
                        {room === null
                          ? "bandwidth not set"
                          : room <= 0
                            ? "full"
                            : `${room} free`}{" "}
                        · {used}/{s.bandwidth ?? "—"}
                      </span>
                    </span>
                  </span>
                  <span className="flex h-1.5 rounded overflow-hidden border border-border-soft mt-2.5">
                    <span
                      style={{
                        width: `${pct}%`,
                        background:
                          "color-mix(in srgb, var(--accent) 45%, transparent)",
                      }}
                    />
                    <span style={{ width: `${100 - pct}%` }} className="bg-bg-elev-2" />
                  </span>
                </button>
              </form>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          className="flex-1 px-3 py-2 rounded border border-border-soft text-xs hover:bg-bg-elev-2"
        >
          {source === "contested"
            ? "Nobody — leave for the pool"
            : "Skip — leave unassigned"}
        </button>
      </div>
    </div>
  );
}
