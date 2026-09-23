"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { searchPeopleAction } from "@/app/actions/search";
import type { SearchHit } from "@/lib/people-read";
import type { PayerReviewRow } from "@/lib/pushpay-import";
import {
  assignPayerAction,
  clearPayerMatchAction,
  rematchPayersAction,
} from "@/app/(app)/pushpay/actions";

/** Re-run matching over the stored giver profiles with the current rules and
 *  the latest PCO people. No re-upload; hand matches are kept. */
export function RematchButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await rematchPayersAction();
            setMsg(r.message);
          })
        }
        className="text-xs px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 cursor-pointer transition-colors"
      >
        {pending ? "Matching…" : "Match again with the latest PCO data"}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}

export function ReviewList({
  givers,
  status,
}: {
  givers: PayerReviewRow[];
  status: string;
}) {
  if (givers.length === 0) {
    return (
      <div className="rounded-xl border border-border-soft px-5 py-10 text-center">
        <p className="text-sm text-muted">
          {status === "ambiguous"
            ? "Nothing to review — every giver whose details fitted more than one person has been placed."
            : status === "unmatched"
              ? "No unplaced givers. Everyone in the export lined up with a person."
              : status === "matched"
                ? "No giver has been matched automatically yet."
                : "No giver has been placed by hand yet."}
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {givers.map((g) => (
        <GiverCard key={g.payerId} giver={g} />
      ))}
    </ul>
  );
}

function GiverCard({ giver }: { giver: PayerReviewRow }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(giver.status === "unmatched");

  function assign(personId: string) {
    const fd = new FormData();
    fd.set("payerId", giver.payerId);
    fd.set("personId", personId);
    start(async () => {
      const r = await assignPayerAction(fd);
      setError(r.ok ? null : r.message ?? "Could not place that giver.");
    });
  }
  function clearMatch() {
    const fd = new FormData();
    fd.set("payerId", giver.payerId);
    start(async () => {
      const r = await clearPayerMatchAction(fd);
      setError(r.ok ? null : r.message ?? "Could not unassign that giver.");
    });
  }

  const assigned = giver.personId !== null;
  const byHand = giver.status === "manual";
  // Unassign hands a giver back to automatic matching, which for anyone the
  // export's "Your ID" placed just puts the same person back. So a placed
  // giver also needs a way to be moved to a DIFFERENT person — otherwise a
  // wrong match is visible here and uncorrectable.
  const [showMove, setShowMove] = useState(false);

  return (
    <li className={`rounded-xl border border-border-soft p-4 ${pending ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/* Who the giver is, and what they give */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{giver.fullName}</span>
            {byHand && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-soft-bg text-accent-soft-fg">
                placed by hand
              </span>
            )}
            {giver.pattern && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted">
                {giver.pattern}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted space-y-0.5">
            {giver.email && <div className="truncate">{giver.email}</div>}
            {giver.phone && <div>{giver.phone}</div>}
            <div className="text-subtle">
              {giver.gifts > 0 ? (
                <>
                  {giver.gifts.toLocaleString()} gift{giver.gifts === 1 ? "" : "s"}
                  {giver.firstGiftOn && giver.lastGiftOn
                    ? `, ${giver.firstGiftOn} to ${giver.lastGiftOn}`
                    : ""}
                  {giver.method ? ` · ${giver.method}` : ""}
                </>
              ) : (
                "no gifts in the loaded window"
              )}
            </div>
            {giver.funds && <div className="text-subtle truncate">{giver.funds}</div>}
          </div>
        </div>

        {/* What to do about them */}
        <div className="min-w-0 w-full sm:w-auto sm:max-w-md sm:flex-1">
          {assigned ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border-softer bg-bg-elev px-3 py-2">
                <span className="text-xs text-muted min-w-0">
                  <span className="text-good-soft-fg font-medium">✓ Their gifts go to</span>{" "}
                  <Link href={`/people/${giver.personId}`} className="text-accent hover:underline">
                    {giver.assignedName ?? `PCO #${giver.personId}`}
                  </Link>
                </span>
                <button
                  type="button"
                  onClick={clearMatch}
                  disabled={pending}
                  title="Hand this giver back to automatic matching"
                  className="text-xs text-subtle hover:text-warn-soft-fg shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Unassign
                </button>
              </div>
              {showMove ? (
                <PersonPicker onPick={(id) => assign(id)} disabled={pending} />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowMove(true)}
                  className="text-xs text-accent hover:underline cursor-pointer"
                >
                  Wrong person? Place them with someone else →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {giver.candidates.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-subtle mb-1">
                    Could be one of these — click a name to place them
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {giver.candidates.map((c) => (
                      <div
                        key={c.pcoId}
                        className="flex items-center gap-2 flex-wrap rounded-lg border border-border-soft px-2.5 py-1.5"
                      >
                        <button
                          type="button"
                          onClick={() => assign(c.pcoId)}
                          disabled={pending}
                          className="text-sm font-medium text-accent hover:underline cursor-pointer disabled:opacity-50"
                        >
                          {c.name}
                        </button>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            c.active ? "bg-good-soft-bg text-good-soft-fg" : "bg-bg-elev-2 text-subtle"
                          }`}
                        >
                          {c.active ? "active" : "inactive"}
                        </span>
                        {c.sharesEmail && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft-bg text-accent-soft-fg">
                            same email
                          </span>
                        )}
                        {c.sharesPhone && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft-bg text-accent-soft-fg">
                            same phone
                          </span>
                        )}
                        <a
                          href={`https://people.planningcenteronline.com/people/${c.pcoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-[11px] text-subtle hover:text-accent"
                        >
                          view in PCO ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showPicker ? (
                <PersonPicker onPick={(id) => assign(id)} disabled={pending} />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="text-xs text-accent hover:underline cursor-pointer"
                >
                  Place with someone else →
                </button>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-xs text-warn-soft-fg">{error}</p>}
        </div>
      </div>
    </li>
  );
}

/** Debounced person typeahead → calls onPick(pcoId) when a person is chosen. */
function PersonPicker({
  onPick,
  disabled,
}: {
  onPick: (pcoId: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqRef = useRef(0);

  // Debounced search: each keystroke cancels the pending timer and any
  // in-flight request (via reqRef), so we only actually search ~350ms after you
  // stop typing — not on every keystroke. Runs from the change handler (not an
  // effect) so we never setState synchronously during render/commit.
  function onQueryChange(next: string) {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    reqRef.current++; // invalidate any in-flight response from prior keystrokes
    if (next.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const id = ++reqRef.current;
      const res = await searchPeopleAction(next);
      if (id !== reqRef.current) return;
      setHits(res.hits);
      setLoading(false);
    }, 350);
  }

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by name, email, or phone…"
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent border border-border-soft rounded-lg px-3 py-1.5 text-sm placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-50"
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-subtle">
            …
          </span>
        )}
      </div>
      {hits.length > 0 && (
        <ul className="mt-1 rounded-lg border border-border-soft bg-bg-elev overflow-hidden divide-y divide-border-softer">
          {hits.map((h) => (
            <li key={h.pcoId}>
              <button
                type="button"
                onClick={() => onPick(h.pcoId)}
                disabled={disabled}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-3 hover:bg-bg-elev-2 cursor-pointer disabled:opacity-50"
              >
                <span className="w-6 h-6 rounded-full bg-bg-elev-2 grid place-items-center text-[10px] font-medium shrink-0">
                  {h.initials}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{h.fullName}</span>
                  <span className="block text-[11px] text-muted truncate">
                    PCO #{h.pcoId}
                    {h.membershipType ? ` · ${h.membershipType}` : ""} · {h.classification}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
