"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { searchPeopleAction } from "@/app/actions/search";
import type { SearchHit } from "@/lib/people-read";
import type { DonorRow } from "@/lib/pushpay-import";
import {
  assignDonorAction,
  clearDonorMatchAction,
  rematchDonorsAction,
} from "@/app/(app)/pushpay/actions";

/** Re-run matching on the imported donors with the latest rules (no re-upload). */
export function RematchButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await rematchDonorsAction(); setMsg(r.message); })}
        className="text-xs px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg disabled:opacity-50 cursor-pointer transition-colors"
      >
        {pending ? "Re-matching…" : "Re-match with latest rules"}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}

export function ReconcileList({
  donors,
  status,
}: {
  donors: DonorRow[];
  status: string;
}) {
  if (donors.length === 0) {
    return (
      <div className="rounded-xl border border-border-soft px-5 py-10 text-center">
        <p className="text-sm text-muted">
          {status === "ambiguous"
            ? "Nothing ambiguous to review — every multi-candidate donor has been assigned."
            : status === "unmatched"
              ? "No unmatched donors. Everyone in the export lined up with a person."
              : "No donors here yet."}
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {donors.map((d) => (
        <DonorCard key={d.donorKey} donor={d} />
      ))}
    </ul>
  );
}

function DonorCard({ donor }: { donor: DonorRow }) {
  const [pending, start] = useTransition();
  const [showPicker, setShowPicker] = useState(donor.status === "unmatched");

  function assign(personId: string) {
    const fd = new FormData();
    fd.set("donorKey", donor.donorKey);
    fd.set("personId", personId);
    start(() => assignDonorAction(fd));
  }
  function clearMatch() {
    const fd = new FormData();
    fd.set("donorKey", donor.donorKey);
    start(() => clearDonorMatchAction(fd));
  }

  const assigned = donor.status === "matched" || donor.status === "manual";

  return (
    <li
      className={`rounded-xl border border-border-soft p-4 ${pending ? "opacity-50" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/* Donor identity */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{donor.fullName}</span>
            {donor.stage && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted">
                {donor.stage}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted space-y-0.5">
            {donor.email && <div className="truncate">{donor.email}</div>}
            {donor.phone && <div>{donor.phone}</div>}
            <div className="text-subtle">
              {donor.lastGiftDate ? `Last gift ${donor.lastGiftDate}` : "No gift date"}
              {donor.fund ? ` · ${donor.fund}` : ""}
              {donor.channel ? ` · ${donor.channel}` : ""}
            </div>
          </div>
        </div>

        {/* Action area */}
        <div className="min-w-0 w-full sm:w-auto sm:max-w-md sm:flex-1">
          {assigned ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border-softer bg-bg-elev px-3 py-2">
              <span className="text-xs text-muted min-w-0">
                <span className="text-good-soft-fg font-medium">✓ Assigned</span>{" "}
                to{" "}
                {donor.personId ? (
                  <Link
                    href={`/people/${donor.personId}`}
                    className="text-accent hover:underline"
                  >
                    {donor.assignedName ?? `PCO #${donor.personId}`}
                  </Link>
                ) : (
                  "—"
                )}
              </span>
              <button
                type="button"
                onClick={clearMatch}
                disabled={pending}
                className="text-xs text-subtle hover:text-warn-soft-fg shrink-0 cursor-pointer disabled:opacity-50"
              >
                Unassign
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {donor.candidates.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-subtle mb-1">
                    Likely the same person
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {donor.candidates.map((c) => (
                      <button
                        key={c.pcoId}
                        type="button"
                        onClick={() => assign(c.pcoId)}
                        disabled={pending}
                        className="px-2.5 py-1 rounded-lg border border-accent text-accent hover:bg-accent hover:text-bg text-xs font-medium cursor-pointer disabled:opacity-50"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showPicker ? (
                <PersonPicker
                  onPick={(id) => assign(id)}
                  disabled={pending}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="text-xs text-accent hover:underline cursor-pointer"
                >
                  Assign to someone else →
                </button>
              )}
            </div>
          )}
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

  // Debounced search runs from the change handler (not an effect) so we never
  // setState synchronously during render/commit.
  function onQueryChange(next: string) {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
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
    }, 180);
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
