"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  TARGET_KIND_HINTS,
  TARGET_KIND_LABELS,
  type TargetKind,
  type TargetOption,
} from "@/lib/assignments-types";
import {
  addConnectionAction,
  assignPeopleAction,
  searchPeopleAction,
  type OversightState,
} from "./actions";

/** Tabs in the order you reach for them: a roster first, a named person
 *  when there is no roster to point at. */
const KIND_ORDER: TargetKind[] = [
  "group",
  "group_type",
  "team",
  "service_type",
  "team_position",
  "membership_type",
  "reference_list",
  "shepherd_team",
  "person",
];

type Mode = TargetKind | "people";

/** "+ Add a connection".
 *
 *  Two things can be added here and they are not the same thing. A roster
 *  — a group, a type, a team, a list — is a standing connection: whoever
 *  joins it later is theirs too. A named person is a one-off assignment,
 *  and because a person has exactly one shepherd, picking somebody already
 *  assigned moves them rather than adding a second claim. The modal says
 *  which one you are doing.
 */
export function AddConnection({
  shepherdPersonId,
  shepherdName,
  targetsByKind,
  counts,
  connectedKeys,
  assignedPersonIds,
  load,
  bandwidth,
}: {
  shepherdPersonId: string;
  shepherdName: string;
  targetsByKind: Record<TargetKind, TargetOption[]>;
  /** "kind:targetId" → people it brings. Missing = we don't count that kind. */
  counts: Record<string, number>;
  /** "kind:targetId" of what they already oversee, so it can't be re-added. */
  connectedKeys: string[];
  assignedPersonIds: string[];
  /** What they carry today — the running total counts up from here. */
  load: number;
  bandwidth: number;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("group");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  // Keyed by the query it answers, so "results for the thing you typed two
  // letters ago" can never be shown as results for this one — and so the
  // effect below never has to set state synchronously to clear them.
  const [found, setFound] = useState<{
    q: string;
    rows: Array<{ id: string; name: string; classification: string }>;
  }>({ q: "", rows: [] });

  const [addState, addAction, addPending] = useActionState<
    OversightState | null,
    FormData
  >(addConnectionAction, null);
  const [peopleState, peopleAction, peoplePending] = useActionState<
    OversightState | null,
    FormData
  >(assignPeopleAction, null);

  const connected = useMemo(() => new Set(connectedKeys), [connectedKeys]);
  const alreadyAssigned = useMemo(
    () => new Set(assignedPersonIds),
    [assignedPersonIds],
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const q = query.trim();
  const people = found.q === q ? found.rows : [];
  const searching = mode === "people" && q.length >= 2 && found.q !== q;

  // People search runs on the server — see searchPeopleAction for why.
  useEffect(() => {
    if (mode !== "people" || q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      searchPeopleAction(q).then((rows) => {
        if (live) setFound({ q, rows });
      });
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, mode]);

  function close() {
    setOpen(false);
    setMode("group");
    setSelected(new Set());
    setQuery("");
    setFound({ q: "", rows: [] });
  }

  function pickMode(m: Mode) {
    setMode(m);
    setSelected(new Set());
    setQuery("");
    setFound({ q: "", rows: [] });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rosterOptions = useMemo(() => {
    if (mode === "people") return [];
    const base =
      mode === "person"
        ? targetsByKind[mode].filter((o) => o.id !== shepherdPersonId)
        : targetsByKind[mode];
    const q = query.trim().toLowerCase();
    return q ? base.filter((o) => o.name.toLowerCase().includes(q)) : base;
  }, [mode, targetsByKind, shepherdPersonId, query]);

  // What the ticked boxes would add. Rosters overlap in real life, so this
  // is an upper bound and labelled as "up to".
  const adding = useMemo(() => {
    if (mode === "people") return selected.size;
    let n = 0;
    for (const id of selected) n += counts[`${mode}:${id}`] ?? 0;
    return n;
  }, [selected, mode, counts]);

  const state = mode === "people" ? peopleState : addState;
  const pending = mode === "people" ? peoplePending : addPending;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-border-soft text-sm text-muted hover:text-fg hover:border-accent transition-colors cursor-pointer min-h-[104px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        + Add a connection
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[6vh] overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-2xl rounded-xl bg-bg-elev border border-border-soft shadow-2xl flex flex-col max-h-[88vh]">
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border-soft shrink-0">
              <div>
                <h2 className="text-base font-semibold">Add a connection</h2>
                <p className="text-xs text-muted mt-0.5">
                  Who does{" "}
                  <span className="text-fg font-medium">{shepherdName}</span>{" "}
                  oversee?
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-muted hover:text-fg cursor-pointer text-xl leading-none -mt-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                ×
              </button>
            </div>

            <div className="px-6 pt-4 shrink-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => pickMode("people")}
                  aria-pressed={mode === "people"}
                  className={tabClass(mode === "people")}
                >
                  Named people
                </button>
                {KIND_ORDER.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => pickMode(k)}
                    aria-pressed={mode === k}
                    className={tabClass(mode === k)}
                  >
                    {TARGET_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-subtle mt-2">
                {mode === "people"
                  ? "One person at a time, by name. Anyone already assigned to another shepherd moves here."
                  : TARGET_KIND_HINTS[mode]}
              </p>
            </div>

            <form
              action={mode === "people" ? peopleAction : addAction}
              onSubmit={() => setTimeout(close, 0)}
              className="flex flex-col min-h-0 flex-1"
            >
              <input
                type="hidden"
                name="shepherdPersonId"
                value={shepherdPersonId}
              />
              {mode !== "people" && (
                <input type="hidden" name="targetKind" value={mode} />
              )}
              {[...selected].map((id) => (
                <input
                  key={id}
                  type="hidden"
                  name={mode === "people" ? "personId" : "targetId"}
                  value={id}
                />
              ))}

              <div className="px-6 py-4 overflow-y-auto space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                    {mode === "people"
                      ? "Search by name"
                      : `Pick ${TARGET_KIND_LABELS[mode].toLowerCase()}${mode === "shepherd_team" ? "" : "s"}`}
                  </span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={mode === "people" ? "Name…" : "Search…"}
                    autoFocus={mode === "people"}
                    className="bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1 text-xs text-fg placeholder:text-subtle w-48 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>

                <div className="rounded-lg border border-border-soft max-h-72 overflow-y-auto divide-y divide-border-softer">
                  {mode === "people" ? (
                    query.trim().length < 2 ? (
                      <Empty>Type at least two letters.</Empty>
                    ) : searching ? (
                      <Empty>Searching…</Empty>
                    ) : people.length === 0 ? (
                      <Empty>Nobody matches &ldquo;{query}&rdquo;.</Empty>
                    ) : (
                      people.map((p) => (
                        <Option
                          key={p.id}
                          checked={selected.has(p.id)}
                          disabled={alreadyAssigned.has(p.id)}
                          onToggle={() => toggle(p.id)}
                          label={p.name}
                          right={
                            alreadyAssigned.has(p.id)
                              ? "already theirs"
                              : p.classification
                          }
                        />
                      ))
                    )
                  ) : rosterOptions.length === 0 ? (
                    <Empty>
                      {query
                        ? `Nothing matches “${query}”.`
                        : "Nothing of this type synced yet."}
                    </Empty>
                  ) : (
                    rosterOptions.map((o) => {
                      const key = `${mode}:${o.id}`;
                      const n = counts[key];
                      return (
                        <Option
                          key={o.id}
                          checked={selected.has(o.id)}
                          disabled={connected.has(key)}
                          onToggle={() => toggle(o.id)}
                          label={o.name}
                          right={
                            connected.has(key)
                              ? "already connected"
                              : n === undefined
                                ? undefined
                                : `${n.toLocaleString()} ${n === 1 ? "person" : "people"}`
                          }
                        />
                      );
                    })
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <span className="text-muted tnum">
                    {selected.size.toLocaleString()} selected
                  </span>
                  {selected.size > 0 && adding > 0 && (
                    <span className="text-subtle tnum">
                      up to +{adding.toLocaleString()} &rarr;{" "}
                      <strong className="text-fg">
                        {(load + adding).toLocaleString()}
                      </strong>
                      {` of ${bandwidth.toLocaleString()}`}
                    </span>
                  )}
                  {selected.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="text-muted hover:text-fg cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {mode !== "people" && (
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                      Note (optional)
                    </span>
                    <input
                      type="text"
                      name="note"
                      placeholder="e.g. interim — through the fall"
                      maxLength={500}
                      className="w-full bg-bg-elev-2 border border-border-soft rounded px-2.5 py-1.5 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </label>
                )}

                {state?.status === "error" && state.message && (
                  <p className="text-xs text-bad-soft-fg">{state.message}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-soft shrink-0">
                <button
                  type="button"
                  onClick={close}
                  className="px-3 py-1.5 rounded-lg border border-border-soft text-muted hover:text-fg cursor-pointer text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={selected.size === 0 || pending}
                  className="px-3.5 py-1.5 rounded-lg bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {pending
                    ? "Saving…"
                    : mode === "people"
                      ? `Assign ${selected.size || ""}`.trim()
                      : `Add ${selected.size || ""}`.trim()}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function tabClass(active: boolean) {
  return `px-3 py-2 rounded-lg border text-xs font-medium text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    active
      ? "border-accent bg-accent-soft-bg text-accent-soft-fg"
      : "border-border-soft text-fg hover:border-accent"
  }`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-8 text-center text-sm text-muted">{children}</div>
  );
}

function Option({
  checked,
  disabled,
  onToggle,
  label,
  right,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
  right?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 px-3 py-2 ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:bg-bg-elev-2/60"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="cursor-pointer shrink-0 disabled:cursor-not-allowed"
      />
      <span className="text-sm truncate flex-1">{label}</span>
      {right && (
        <span className="text-[11px] text-subtle tnum shrink-0">{right}</span>
      )}
    </label>
  );
}
