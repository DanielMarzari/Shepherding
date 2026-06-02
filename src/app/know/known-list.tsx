"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { IntakeCandidate } from "@/lib/shepherd-intake";
import { toggleKnownAction } from "./actions";

const BATCH = 50;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Surname initial for the A-Z jump rail; non-letters bucket under "#". */
function initialOf(c: IntakeCandidate): string {
  const ch = (c.lastName || c.fullName).trim()[0]?.toUpperCase() ?? "#";
  return /[A-Z]/.test(ch) ? ch : "#";
}

/** "Who do you know" — a guided review rather than a wall of names.
 *  The roster (sorted by last name) is worked through one batch at a
 *  time with a progress bar and a "names to go" counter; everyone you
 *  check collects in a side panel. Search jumps straight to a person;
 *  the A-Z rail jumps the window to that letter. Optimistic toggles. */
export function KnownList({ initial }: { initial: IntakeCandidate[] }) {
  const [known, setKnownState] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const c of initial) m[c.personId] = c.known;
    return m;
  });
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, IntakeCandidate>();
    for (const c of initial) m.set(c.personId, c);
    return m;
  }, [initial]);

  // Roster sorted by last name — the stable browse order.
  const sorted = useMemo(
    () =>
      [...initial].sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.fullName.localeCompare(b.fullName),
      ),
    [initial],
  );
  const total = sorted.length;

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? sorted.filter((c) => c.fullName.toLowerCase().includes(q)) : []),
    [sorted, q],
  );

  // First index in `sorted` for each surname-initial — powers the rail.
  const letterIndex = useMemo(() => {
    const m: Record<string, number> = {};
    sorted.forEach((c, i) => {
      const L = initialOf(c);
      if (m[L] === undefined) m[L] = i;
    });
    return m;
  }, [sorted]);

  const start = Math.min(offset, Math.max(0, total - 1));
  const windowRows = sorted.slice(start, start + BATCH);
  const end = start + windowRows.length; // exclusive
  const toGo = total - end;
  const pct = total === 0 ? 0 : Math.round((end / total) * 100);
  const activeLetter = windowRows[0] ? initialOf(windowRows[0]) : null;

  const markedIds = useMemo(
    () =>
      Object.keys(known)
        .filter((id) => known[id])
        .sort((a, b) => {
          const ca = byId.get(a);
          const cb = byId.get(b);
          return (
            (ca?.lastName ?? "").localeCompare(cb?.lastName ?? "") ||
            (ca?.fullName ?? "").localeCompare(cb?.fullName ?? "")
          );
        }),
    [known, byId],
  );
  const markedCount = markedIds.length;

  useEffect(() => {
    if (q) setOffset(0);
  }, [q]);

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

  function moveTo(next: number) {
    setOffset(Math.max(0, Math.min(next, Math.max(0, total - 1))));
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
      {/* ── Main column ───────────────────────────────────────────── */}
      <div className="space-y-4 order-last lg:order-first">
        <div className="relative">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-subtle pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for someone by name…"
            aria-label="Search people by name"
            className="w-full bg-bg-elev-2 border border-border-soft rounded-xl pl-11 pr-3 py-3 text-base text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-shadow"
          />
        </div>
        {error && <p className="text-sm text-warn-soft-fg">{error}</p>}

        {q ? (
          /* ── Search results ─────────────────────────────────────── */
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs uppercase tracking-wider text-subtle font-medium">
                Matches for “{query.trim()}”
              </h2>
              <span className="text-xs text-subtle tnum">
                {matches.length} found
              </span>
            </div>
            {matches.length === 0 ? (
              <p className="text-sm text-muted py-10 text-center">
                No one matches{" "}
                <span className="text-fg">“{query.trim()}”</span>. Try a last
                name, or a different spelling.
              </p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {matches.slice(0, 100).map((c) => (
                  <PersonRow
                    key={c.personId}
                    candidate={c}
                    known={!!known[c.personId]}
                    onToggle={() => toggle(c.personId)}
                  />
                ))}
              </ul>
            )}
          </section>
        ) : (
          /* ── Guided review ──────────────────────────────────────── */
          <>
            {/* Progress */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-fg">
                  {markedCount > 0
                    ? `${markedCount} marked so far`
                    : "Tap everyone you know"}
                </span>
                <span className="text-xs text-muted tnum">
                  {toGo > 0 ? `${toGo.toLocaleString()} to go` : "End of list"}
                </span>
              </div>
              <div
                className="h-2 rounded-full bg-bg-elev-2 overflow-hidden"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress through the directory"
              >
                <div
                  className="h-full bg-accent rounded-full transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-subtle tnum">
                {total === 0
                  ? "No one to show"
                  : `Showing ${start + 1}–${end} of ${total.toLocaleString()}`}
              </p>
            </div>

            {/* A-Z jump rail */}
            {total > BATCH && (
              <div
                className="flex flex-wrap gap-1"
                role="group"
                aria-label="Jump to letter"
              >
                {ALPHABET.map((L) => {
                  const idx = letterIndex[L];
                  const enabled = idx !== undefined;
                  const active = enabled && L === activeLetter;
                  return (
                    <button
                      key={L}
                      type="button"
                      disabled={!enabled}
                      onClick={() => enabled && moveTo(idx)}
                      aria-label={`Jump to ${L}`}
                      className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${
                        active
                          ? "bg-accent/20 text-fg"
                          : enabled
                            ? "text-muted hover:text-fg hover:bg-bg-elev-2 cursor-pointer"
                            : "text-subtle/40 cursor-default"
                      }`}
                    >
                      {L}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Current batch */}
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {windowRows.map((c) => (
                <PersonRow
                  key={c.personId}
                  candidate={c}
                  known={!!known[c.personId]}
                  onToggle={() => toggle(c.personId)}
                />
              ))}
            </ul>

            {/* Back / Next */}
            {total > BATCH && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => moveTo(start - BATCH)}
                  disabled={start === 0}
                  className="px-4 h-11 rounded-xl border border-border-soft text-sm text-muted hover:text-fg hover:border-accent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  ‹ Back
                </button>
                {toGo > 0 ? (
                  <button
                    type="button"
                    onClick={() => moveTo(start + BATCH)}
                    className="flex-1 sm:flex-none px-6 h-11 rounded-xl bg-accent text-[var(--accent-fg)] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Next {Math.min(BATCH, toGo)} ›
                  </button>
                ) : (
                  <span className="text-sm text-muted">
                    That&apos;s everyone — thank you.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Aside: people you've marked ───────────────────────────── */}
      <aside className="order-first lg:order-last lg:sticky lg:top-4">
        <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">People you know</h2>
            <span className="text-xs text-muted tnum">{markedCount} marked</span>
          </div>
          {markedCount === 0 ? (
            <p className="text-sm text-muted leading-relaxed">
              Nobody yet. Work through the list (or search) and tap the people
              you personally know — they&apos;ll collect here.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {markedIds.map((id) => {
                const c = byId.get(id);
                if (!c) return null;
                return (
                  <li key={id}>
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-fg truncate">
                        {c.fullName}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        aria-label={`Remove ${c.fullName}`}
                        className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-subtle hover:text-warn-soft-fg hover:bg-bg-elev-2 transition-colors cursor-pointer"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
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
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
            known
              ? "bg-accent border-accent text-[var(--accent-fg)]"
              : "border-border-soft text-transparent"
          }`}
          aria-hidden
        >
          <CheckIcon className="w-3 h-3" />
        </span>
        <span
          className={`flex-1 text-sm truncate ${
            known ? "text-fg font-medium" : "text-fg/90"
          }`}
        >
          {candidate.fullName}
        </span>
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
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
