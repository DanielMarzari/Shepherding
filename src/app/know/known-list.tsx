"use client";

import { useMemo, useState, useTransition } from "react";
import type { IntakeCandidate } from "@/lib/shepherd-intake";
import { toggleKnownAction } from "./actions";

const SEARCH_CAP = 60;

/** Progressive-disclosure "who do you know" list. A shepherd never
 *  faces the full ~1,400-name wall: the resting state shows only the
 *  people they've already marked plus a search box, and names surface
 *  one search (or one letter) at a time. Search-first, mobile-first,
 *  optimistic toggles. */
export function KnownList({ initial }: { initial: IntakeCandidate[] }) {
  const [known, setKnownState] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const c of initial) m[c.personId] = c.known;
    return m;
  });
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, IntakeCandidate>();
    for (const c of initial) m.set(c.personId, c);
    return m;
  }, [initial]);

  const markedIds = useMemo(
    () =>
      Object.keys(known)
        .filter((id) => known[id])
        .sort((a, b) =>
          (byId.get(a)?.fullName ?? "").localeCompare(
            byId.get(b)?.fullName ?? "",
          ),
        ),
    [known, byId],
  );

  const letters = useMemo(() => {
    const s = new Set<string>();
    for (const c of initial) {
      const ch = c.fullName.trim()[0]?.toUpperCase() ?? "#";
      s.add(/[A-Z]/.test(ch) ? ch : "#");
    }
    return [...s].sort();
  }, [initial]);

  // What to show in the results pane, and why.
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (q) {
      const hits = initial.filter((c) => c.fullName.toLowerCase().includes(q));
      return { rows: hits.slice(0, SEARCH_CAP), total: hits.length };
    }
    if (letter) {
      const hits = initial.filter((c) => {
        const ch = c.fullName.trim()[0]?.toUpperCase() ?? "#";
        return (/[A-Z]/.test(ch) ? ch : "#") === letter;
      });
      return { rows: hits, total: hits.length };
    }
    return { rows: [], total: 0 };
  }, [initial, q, letter]);

  function toggle(personId: string) {
    const next = !known[personId];
    setKnownState((p) => ({ ...p, [personId]: next }));
    setError(null);
    startTransition(async () => {
      const res = await toggleKnownAction(personId, next);
      if (!res.ok) {
        setKnownState((p) => ({ ...p, [personId]: !next }));
        setError("Your session expired — refresh and sign in again.");
      }
    });
  }

  const browsing = q.length > 0 || letter !== null;

  return (
    <div className="space-y-5">
      {/* Search — the primary action. */}
      <div className="sticky top-0 z-10 bg-bg pt-1 pb-2 space-y-3">
        <div className="relative">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-subtle pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLetter(null);
            }}
            placeholder="Search for someone by name…"
            aria-label="Search people by name"
            className="w-full bg-bg-elev-2 border border-border-soft rounded-xl pl-11 pr-3 py-3 text-base text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-shadow"
          />
        </div>
        {error && <p className="text-sm text-warn-soft-fg">{error}</p>}
      </div>

      {/* RESULTS pane — only ever shows one search or one letter's
          worth of names, never the whole directory. */}
      {browsing ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xs uppercase tracking-wider text-subtle font-medium">
              {q
                ? `Matches for “${query.trim()}”`
                : `Names starting with ${letter}`}
            </h2>
            {(letter || q) && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setLetter(null);
                }}
                className="text-xs text-accent hover:underline cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          {results.rows.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">
              No one matches{" "}
              <span className="text-fg">“{query.trim()}”</span>. Try a first
              name, or a different spelling.
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {results.rows.map((c) => (
                <PersonRow
                  key={c.personId}
                  candidate={c}
                  known={!!known[c.personId]}
                  onToggle={() => toggle(c.personId)}
                />
              ))}
            </ul>
          )}
          {results.total > results.rows.length && (
            <p className="text-xs text-subtle text-center pt-1">
              Showing {results.rows.length} of {results.total} — keep typing
              to narrow it down.
            </p>
          )}
        </section>
      ) : (
        <>
          {/* RESTING state: their marked people + how to add more. No
              wall of names. */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">People you know</h2>
              <span className="text-xs text-muted tnum">
                {markedIds.length} marked
              </span>
            </div>
            {markedIds.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-soft px-5 py-8 text-center">
                <p className="text-sm text-muted">
                  Nobody marked yet. Search a name above (or browse by
                  letter) and tap the people you personally know.
                </p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {markedIds.map((id) => {
                  const c = byId.get(id);
                  if (!c) return null;
                  return (
                    <PersonRow
                      key={id}
                      candidate={c}
                      known
                      onToggle={() => toggle(id)}
                    />
                  );
                })}
              </ul>
            )}
          </section>

          {/* Browse-by-letter — opt-in disclosure of a small slice. */}
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wider text-subtle font-medium">
              Or browse by first name
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {letters.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => {
                    setLetter(l);
                    setQuery("");
                  }}
                  className="w-9 h-9 rounded-lg border border-border-soft text-sm text-muted hover:text-fg hover:border-accent hover:bg-bg-elev-2/60 transition-colors cursor-pointer"
                >
                  {l}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function PersonRow({
  candidate,
  known,
  onToggle,
}: {
  candidate: IntakeCandidate;
  known: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={known}
        className={`w-full min-h-[48px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
          known
            ? "border-accent/50 bg-accent/10"
            : "border-border-soft hover:bg-bg-elev-2/60"
        }`}
      >
        <span
          className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
            known
              ? "bg-accent border-accent text-[var(--accent-fg)]"
              : "border-border-soft text-transparent"
          }`}
          aria-hidden
        >
          <CheckIcon className="w-3.5 h-3.5" />
        </span>
        <span
          className={`flex-1 text-sm truncate ${
            known ? "text-fg font-medium" : "text-fg/90"
          }`}
        >
          {candidate.fullName}
        </span>
        {known && (
          <span className="text-[11px] text-accent shrink-0">Known</span>
        )}
      </button>
    </li>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
