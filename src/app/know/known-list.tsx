"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { IntakeCandidate } from "@/lib/shepherd-intake";
import { toggleKnownAction } from "./actions";

const PAGE_SIZE = 60;

/** Sort key by LAST name (then full name to break ties). Names display
 *  as-entered, but ordering follows the surname so the directory reads
 *  like a church roll. */
function lastNameKey(full: string): string {
  const parts = full.trim().split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "";
  return `${last} ${full}`.toLowerCase();
}

/** Initial of the LAST name, for the A-Z jump rail. Non-letters bucket
 *  under "#". */
function lastInitial(full: string): string {
  const parts = full.trim().split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "";
  const ch = last[0]?.toUpperCase() ?? "#";
  return /[A-Z]/.test(ch) ? ch : "#";
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** "Who do you know" list. A shepherd never faces the whole ~1,400-name
 *  wall at once: search is the primary action, the roster is paged in
 *  manageable chunks (sorted by last name), and everyone they've marked
 *  collects in a side panel so their progress stays in view.
 *  Mobile-first, optimistic toggles. */
export function KnownList({ initial }: { initial: IntakeCandidate[] }) {
  const [known, setKnownState] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const c of initial) m[c.personId] = c.known;
    return m;
  });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, IntakeCandidate>();
    for (const c of initial) m.set(c.personId, c);
    return m;
  }, [initial]);

  // Whole roster, sorted by last name — the stable browse order.
  const sorted = useMemo(
    () =>
      [...initial].sort((a, b) =>
        lastNameKey(a.fullName).localeCompare(lastNameKey(b.fullName)),
      ),
    [initial],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? sorted.filter((c) => c.fullName.toLowerCase().includes(q)) : sorted),
    [sorted, q],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Reset to page 1 whenever the query changes.
  useEffect(() => setPage(0), [q]);
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  // A-Z jump rail: which page each surname-initial first appears on (in
  // the current, possibly-filtered, ordering). Clicking a letter pages
  // to that slice instead of hiding the rest.
  const letterPage = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach((c, i) => {
      const L = lastInitial(c.fullName);
      if (m[L] === undefined) m[L] = Math.floor(i / PAGE_SIZE);
    });
    return m;
  }, [filtered]);
  const activeLetter = pageRows[0] ? lastInitial(pageRows[0].fullName) : null;

  function goToPage(p: number) {
    setPage(p);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const markedIds = useMemo(
    () =>
      Object.keys(known)
        .filter((id) => known[id])
        .sort((a, b) =>
          lastNameKey(byId.get(a)?.fullName ?? "").localeCompare(
            lastNameKey(byId.get(b)?.fullName ?? ""),
          ),
        ),
    [known, byId],
  );

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
      {/* ── Main: search + paged roster ───────────────────────────── */}
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

        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xs uppercase tracking-wider text-subtle font-medium">
            {q ? `Matches for “${query.trim()}”` : "Everyone"}
          </h2>
          <span className="text-xs text-subtle tnum">
            {filtered.length} {filtered.length === 1 ? "person" : "people"}
          </span>
        </div>

        {/* A-Z jump rail — jumps to that part of the list, doesn't hide
            the rest. Letters with no one are dimmed. */}
        {!q && filtered.length > PAGE_SIZE && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Jump to letter">
            {ALPHABET.map((L) => {
              const target = letterPage[L];
              const enabled = target !== undefined;
              const active = enabled && L === activeLetter;
              return (
                <button
                  key={L}
                  type="button"
                  disabled={!enabled}
                  onClick={() => enabled && goToPage(target)}
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

        {filtered.length === 0 ? (
          <p className="text-sm text-muted py-10 text-center">
            No one matches <span className="text-fg">“{query.trim()}”</span>.
            Try a last name, or a different spelling.
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {pageRows.map((c) => (
                <PersonRow
                  key={c.personId}
                  candidate={c}
                  known={!!known[c.personId]}
                  onToggle={() => toggle(c.personId)}
                />
              ))}
            </ul>
            {pageCount > 1 && (
              <Pager
                page={safePage}
                pageCount={pageCount}
                onChange={goToPage}
              />
            )}
          </>
        )}
      </div>

      {/* ── Aside: people you've marked ───────────────────────────── */}
      <aside className="order-first lg:order-last lg:sticky lg:top-4">
        <div className="rounded-xl border border-border-soft bg-bg-elev-2/40 p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">People you know</h2>
            <span className="text-xs text-muted tnum">
              {markedIds.length} marked
            </span>
          </div>
          {markedIds.length === 0 ? (
            <p className="text-sm text-muted leading-relaxed">
              Nobody yet. Search or scroll the list and tap the people you
              personally know — they&apos;ll collect here.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {markedIds.map((id) => {
                const c = byId.get(id);
                if (!c) return null;
                return (
                  <li key={id}>
                    <div className="flex items-center gap-2 group">
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

/** Windowed segmented pager: « ‹ 1 … 7 8 9 … 24 › ». */
function Pager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  const items: (number | "…")[] = [];
  const push = (n: number) => items.push(n);
  const window = 1; // pages on each side of current
  const lo = Math.max(0, page - window);
  const hi = Math.min(pageCount - 1, page + window);
  push(0);
  if (lo > 1) items.push("…");
  for (let i = Math.max(1, lo); i <= Math.min(pageCount - 2, hi); i++) push(i);
  if (hi < pageCount - 2) items.push("…");
  if (pageCount > 1) push(pageCount - 1);

  const btn =
    "min-w-9 h-9 px-2 rounded-lg border text-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default";

  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-1.5 pt-2"
      aria-label="Pagination"
    >
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page === 0}
        aria-label="Previous page"
        className={`${btn} border-border-soft text-muted hover:text-fg hover:border-accent`}
      >
        ‹
      </button>
      {items.map((it, i) =>
        it === "…" ? (
          <span key={`e${i}`} className="px-1 text-subtle select-none">
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => onChange(it)}
            aria-current={it === page ? "page" : undefined}
            className={`${btn} ${
              it === page
                ? "border-accent bg-accent/15 text-fg font-medium"
                : "border-border-soft text-muted hover:text-fg hover:border-accent"
            }`}
          >
            {it + 1}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page === pageCount - 1}
        aria-label="Next page"
        className={`${btn} border-border-soft text-muted hover:text-fg hover:border-accent`}
      >
        ›
      </button>
    </nav>
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
