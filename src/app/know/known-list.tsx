"use client";

import { useMemo, useState, useTransition } from "react";
import type { IntakeCandidate } from "@/lib/shepherd-intake";
import { toggleKnownAction } from "./actions";

/** The shepherd's mark-who-you-know list. Optimistic toggle with a
 *  server round-trip per change; search to make ~1,400 names
 *  navigable; "known" rows pinned to the top on load. */
export function KnownList({ initial }: { initial: IntakeCandidate[] }) {
  const [known, setKnownState] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const c of initial) m[c.personId] = c.known;
    return m;
  });
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? initial.filter((c) => c.fullName.toLowerCase().includes(q))
      : initial;
    return base;
  }, [initial, query]);

  const knownCount = useMemo(
    () => Object.values(known).filter(Boolean).length,
    [known],
  );

  function toggle(personId: string) {
    const next = !known[personId];
    // Optimistic flip; revert on server failure.
    setKnownState((p) => ({ ...p, [personId]: next }));
    setError(null);
    startTransition(async () => {
      const res = await toggleKnownAction(personId, next);
      if (!res.ok) {
        setKnownState((p) => ({ ...p, [personId]: !next }));
        setError("Your session expired — refresh the page and sign in again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap sticky top-0 z-10 bg-bg py-2 -my-2">

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          className="flex-1 min-w-[200px] bg-bg-elev-2 border border-border-soft rounded-lg px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <span className="text-sm text-muted shrink-0">
          <span className="text-accent font-medium tnum">{knownCount}</span>{" "}
          marked
        </span>
      </div>
      {error && <p className="text-sm text-warn-soft-fg">{error}</p>}
      {filtered.length === 0 ? (
        <p className="px-4 py-10 text-sm text-muted text-center">
          No one matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {filtered.map((c) => {
            const isKnown = !!known[c.personId];
            return (
              <li key={c.personId}>
                <button
                  type="button"
                  onClick={() => toggle(c.personId)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    isKnown
                      ? "border-accent/50 bg-accent/5"
                      : "border-border-soft hover:bg-bg-elev-2/60"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 text-xs ${
                      isKnown
                        ? "bg-accent border-accent text-[var(--accent-fg)]"
                        : "border-border-soft"
                    }`}
                    aria-hidden
                  >
                    {isKnown ? "✓" : ""}
                  </span>
                  <span
                    className={`flex-1 text-sm truncate ${isKnown ? "text-fg font-medium" : "text-muted"}`}
                  >
                    {c.fullName}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
