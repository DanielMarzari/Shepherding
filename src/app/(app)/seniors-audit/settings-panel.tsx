"use client";

import { useActionState, useMemo, useState } from "react";
import type { PickerOption } from "@/lib/seniors-audit-shared";
import { saveSeniorsSettingsAction, type SeniorsState } from "./actions";

const KIND_LABEL: Record<string, string> = {
  signup: "Registrations",
  checkin_event: "Check-in events",
  group_type: "Group types",
  group: "Groups",
};

/** What counts as seniors, folded away until you need it.
 *
 *  Collapsed by default because it is a decision you make once and then
 *  leave alone, and open it would be the longest thing on a page whose
 *  point is the list underneath. The whole picker saves at once: the
 *  lists, the events and the age are one answer to one question.
 */
export function SettingsPanel({
  ccOptions,
  eventOptions,
  ageMin,
  years,
  isAdmin,
}: {
  ccOptions: PickerOption[];
  eventOptions: PickerOption[];
  ageMin: number;
  years: number;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  /** Ticks the suggestions without saving, so you can look before you
   *  commit. Null until the button is pressed, so it never overrides what
   *  is already stored. */
  const [takeSuggested, setTakeSuggested] = useState(false);

  const suggested = useMemo(
    () => [...ccOptions, ...eventOptions].filter((o) => o.suggested && !o.selected),
    [ccOptions, eventOptions],
  );
  const [state, action, pending] = useActionState<SeniorsState | null, FormData>(
    saveSeniorsSettingsAction,
    null,
  );

  const chosen = useMemo(
    () =>
      ccOptions.filter((o) => o.selected).length +
      eventOptions.filter((o) => o.selected).length,
    [ccOptions, eventOptions],
  );

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, PickerOption[]>();
    for (const o of eventOptions) {
      // A ticked option always stays visible, so filtering can never hide
      // something that is quietly still counting.
      if (needle && !o.selected && !o.name.toLowerCase().includes(needle)) continue;
      const arr = out.get(o.kind) ?? [];
      arr.push(o);
      out.set(o.kind, arr);
    }
    // Suggestions first inside each kind: they are the ones worth reading.
    for (const arr of out.values()) {
      arr.sort(
        (a, b) =>
          Number(b.suggested) - Number(a.suggested) ||
          b.people - a.people ||
          a.name.localeCompare(b.name),
      );
    }
    return out;
  }, [eventOptions, q]);

  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-left cursor-pointer hover:bg-bg-elev-2"
      >
        <span>
          <span className="text-sm font-semibold">What counts as seniors</span>
          <span className="text-xs text-subtle ml-2.5">
            {chosen === 0
              ? "nothing chosen yet"
              : `${chosen} chosen · ${ageMin} and older`}
          </span>
        </span>
        <span className="text-xs text-accent">
          {open ? "Hide" : "Choose lists and events"}
        </span>
      </button>

      {open && (
        <form action={action} className="border-t border-border-soft">
          <div className="px-5 py-4 space-y-5">
            {suggested.length > 0 && (
              <div className="rounded border border-accent/40 bg-accent-soft-bg/20 px-3.5 py-3 flex flex-wrap items-center gap-3">
                <p className="text-xs text-muted leading-relaxed flex-1 min-w-[280px]">
                  <strong className="text-fg">
                    {suggested.length} look like Seniors In Action.
                  </strong>{" "}
                  Matched on <span className="mono text-fg">SIA</span> in
                  capitals, which the ministry always uses &mdash; lower-case
                  &ldquo;sia&rdquo; would also catch Malaysia, SE Asia and
                  Iglesia de Fe, so case is the whole signal here. Check them
                  before saving.
                </p>
                <button
                  type="button"
                  onClick={() => setTakeSuggested(true)}
                  disabled={takeSuggested}
                  className="shrink-0 px-3 py-1.5 rounded border border-accent text-accent text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  {takeSuggested ? "Ticked below" : "Tick all of them"}
                </button>
              </div>
            )}
            <Section
              title="Mailing lists"
              note="Constant Contact lists the ministry writes to. Both of the seniors lists count — the retired one still holds people the current one does not."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {ccOptions.map((o) => (
                  <Tick key={o.id} name="ccList" o={o} unit="contacts" take={takeSuggested} />
                ))}
              </div>
            </Section>

            <Section
              title="Seniors events"
              note={`Registrations from the last ${years} years, plus check-in events, group types and groups. Names cannot be trusted here — "SIA" matches SE Asia and Malaysia, "senior" matches the high-school senior trip — so nothing is guessed.`}
            >
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by name…"
                aria-label="Filter the event list"
                className="bg-bg border border-border-soft rounded px-3 py-1.5 text-[13px] w-full max-w-xs mb-3"
              />
              <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
                {Object.keys(KIND_LABEL).map((kind) => {
                  const rows = groups.get(kind) ?? [];
                  if (rows.length === 0) return null;
                  return (
                    <div key={kind}>
                      <div className="text-[10px] uppercase tracking-wider text-subtle mb-1.5">
                        {KIND_LABEL[kind]}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {rows.map((o) => (
                          <Tick
                            key={`${o.kind}:${o.id}`}
                            name={o.kind}
                            o={o}
                            unit="people"
                            take={takeSuggested}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section
              title="Age"
              note="Counted from the birth year on file. People with no birth year are not in this source at all."
            >
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="number"
                  name="ageMin"
                  min={1}
                  max={119}
                  defaultValue={ageMin}
                  className="w-[80px] bg-bg border border-border-soft rounded px-2 py-1 text-right tnum"
                />
                and older
              </label>
            </Section>
          </div>

          <div className="px-5 py-3 bg-bg-elev-2 border-t border-border-soft flex items-center gap-3">
            <button
              type="submit"
              disabled={!isAdmin || pending}
              className="px-3.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium disabled:opacity-50 cursor-pointer"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            {!isAdmin && (
              <span className="text-xs text-subtle">
                Only admins can change this.
              </span>
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
        </form>
      )}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <p className="text-[11px] text-subtle mt-0.5 mb-2.5 max-w-2xl leading-relaxed">
        {note}
      </p>
      {children}
    </div>
  );
}

function Tick({
  name,
  o,
  unit,
  take,
}: {
  name: string;
  o: PickerOption;
  unit: string;
  /** "Tick all of them" was pressed — remount so the box picks up the new
   *  default without taking the field over as controlled state. */
  take: boolean;
}) {
  const on = o.selected || (take && o.suggested);
  return (
    <label className="flex items-center gap-2 text-[13px] rounded px-2 py-1 hover:bg-bg-elev-2 cursor-pointer">
      <input
        key={on ? "on" : "off"}
        type="checkbox"
        name={name}
        value={o.id}
        defaultChecked={on}
        className="accent-[var(--accent)]"
      />
      <span className="min-w-0 flex-1 truncate">
        {o.name}
        {o.suggested && (
          <span className="text-[10px] text-accent border border-accent/40 rounded px-1 py-0.5 ml-1.5 align-middle">
            SIA
          </span>
        )}
      </span>
      <span
        className={`text-[11px] tnum shrink-0 ${
          o.people === 0 ? "text-subtle" : "text-muted"
        }`}
      >
        {o.people === 0 ? `no ${unit}` : `${o.people.toLocaleString()} ${unit}`}
      </span>
    </label>
  );
}
