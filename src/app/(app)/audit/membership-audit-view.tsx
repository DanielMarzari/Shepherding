"use client";

import { useMemo, useState } from "react";
import {
  CONNECTION_LABELS,
  CONNECTION_ORDER,
  LANE_KEYS,
  LANE_LABELS,
  type AuditPersonRow,
  type LaneKey,
  type MembershipAudit,
  agoLabel,
} from "@/lib/membership-audit-shared";

const PCO_PERSON = "https://people.planningcenteronline.com/people/";

/** The coverage strip's bands. Lightness climbs with lane count and the
 *  "no lane" band is the one warm colour on the page, so the shape reads
 *  without relying on hue — amber vs blues differ in lightness too. */
const BAND_STYLE = [
  { bg: "var(--warn-soft-bg)", fg: "var(--warn-soft-fg)", label: "no lane" },
  { bg: "color-mix(in srgb, var(--accent) 14%, transparent)", fg: "var(--fg)", label: "one" },
  { bg: "color-mix(in srgb, var(--accent) 30%, transparent)", fg: "var(--fg)", label: "two" },
  { bg: "color-mix(in srgb, var(--accent) 48%, transparent)", fg: "var(--fg)", label: "three" },
  { bg: "color-mix(in srgb, var(--accent) 70%, transparent)", fg: "var(--accent-fg)", label: "four" },
  { bg: "var(--accent)", fg: "var(--accent-fg)", label: "all five" },
];

type SortKey = "name" | "lanes" | "days" | "connection" | "flags";

export function MembershipAuditView({ audit }: { audit: MembershipAudit }) {
  const [lanes, setLanes] = useState<Set<LaneKey>>(new Set());
  const [bands, setBands] = useState<Set<number>>(new Set());
  const [connections, setConnections] = useState<Set<string>>(new Set());
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("days");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const anyFilter =
    lanes.size > 0 || bands.size > 0 || connections.size > 0 || onlyFlagged;

  const visible = useMemo(() => {
    const out = audit.rows.filter((r) => {
      for (const k of lanes) if (!r.lanes[k]) return false;
      if (bands.size && !bands.has(r.laneCount)) return false;
      if (connections.size && !(r.connection && connections.has(r.connection))) {
        return false;
      }
      if (onlyFlagged && r.flags.length === 0) return false;
      return true;
    });
    const sign = dir === "asc" ? 1 : -1;
    return out.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.fullName.localeCompare(b.fullName) * sign;
        case "lanes":
          return (a.laneCount - b.laneCount) * sign;
        case "connection":
          return (
            (CONNECTION_ORDER.indexOf(a.connection ?? "") -
              CONNECTION_ORDER.indexOf(b.connection ?? "")) * sign
          );
        case "flags":
          return (a.flags.length - b.flags.length) * sign;
        default: {
          // Never-active sorts as the longest silence, not as zero.
          const ad = a.daysSince ?? Number.MAX_SAFE_INTEGER;
          const bd = b.daysSince ?? Number.MAX_SAFE_INTEGER;
          return (ad - bd) * sign;
        }
      }
    });
  }, [audit.rows, lanes, bands, connections, onlyFlagged, sort, dir]);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setDir(k === "name" || k === "connection" ? "asc" : "desc");
    }
  }

  function reset() {
    setLanes(new Set());
    setBands(new Set());
    setConnections(new Set());
    setOnlyFlagged(false);
  }

  function applyCombo(key: string) {
    const next = new Set<LaneKey>();
    for (const ch of key) next.add(ch as LaneKey);
    setLanes(next);
    setBands(key === "" ? new Set([0]) : new Set());
    setOpen(null);
  }

  const readout = (() => {
    const bits: string[] = [];
    if (bands.size) bits.push(`in ${phraseBands(bands)}`);
    if (lanes.size)
      bits.push(
        `including ${[...lanes].map((k) => LANE_LABELS[k]).join(" + ")}`,
      );
    if (connections.size)
      bits.push([...connections].map((c) => CONNECTION_LABELS[c] ?? c).join(" or "));
    if (onlyFlagged) bits.push("needing cleaning");
    return bits.length ? bits.join(" · ") : "everything";
  })();

  return (
    <div className="space-y-4" onClick={() => setOpen(null)}>
      <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-4 space-y-3">
        {/* Coverage strip — click a band to filter by it */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-subtle shrink-0">
            Lanes per member
          </span>
          <div className="flex h-9 flex-1 min-w-[320px] rounded-md overflow-hidden border border-border-soft">
            {audit.bandTotals.map((n, i) => {
              if (n === 0) return null;
              const on = bands.has(i);
              const st = BAND_STYLE[i];
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setBands(toggled(bands, i))}
                  aria-pressed={on}
                  title={`${n} members in ${st.label}`}
                  style={{
                    width: `${(n / Math.max(1, audit.total)) * 100}%`,
                    background: st.bg,
                    color: st.fg,
                    boxShadow: on ? "inset 0 0 0 2px var(--fg)" : undefined,
                  }}
                  className="flex items-center justify-center text-[10px] font-bold tnum transition-[filter] hover:brightness-95"
                >
                  {n}
                  <span className="sr-only"> members in {st.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            id="lanes"
            label="Lanes"
            value={
              lanes.size
                ? [...lanes].map((k) => LANE_LABELS[k]).join(" + ")
                : "any"
            }
            open={open === "lanes"}
            setOpen={setOpen}
            items={LANE_KEYS.map((k) => ({
              id: k,
              label: LANE_LABELS[k],
              count: audit.laneTotals[k],
              checked: lanes.has(k),
            }))}
            onToggle={(id) => setLanes(toggled(lanes, id as LaneKey))}
          />
          <Dropdown
            id="connection"
            label="Connection"
            value={
              connections.size
                ? [...connections].map((c) => CONNECTION_LABELS[c] ?? c).join(" or ")
                : "any"
            }
            open={open === "connection"}
            setOpen={setOpen}
            items={CONNECTION_ORDER.filter(
              (c) => (audit.connectionTotals[c] ?? 0) > 0,
            ).map((c) => ({
              id: c,
              label: CONNECTION_LABELS[c] ?? c,
              count: audit.connectionTotals[c] ?? 0,
              checked: connections.has(c),
            }))}
            onToggle={(id) => setConnections(toggled(connections, id))}
          />

          {/* See by lane — the combination breakdown, on the right */}
          <div
            className="ml-auto relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(open === "bylane" ? null : "bylane")}
              aria-expanded={open === "bylane"}
              className="flex items-center gap-2 rounded-md border border-border-soft bg-bg px-3 py-1.5 text-[13px] text-accent hover:bg-bg-elev-2"
            >
              See by lane
              <span className="text-subtle text-xs">▾</span>
            </button>
            {open === "bylane" && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[460px] rounded-lg border border-border-soft bg-bg-elev p-4 shadow-xl">
                <div className="text-[10px] uppercase tracking-wider text-subtle mb-2.5">
                  Members in each lane
                </div>
                <div className="flex flex-col gap-1.5 mb-4">
                  {LANE_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setLanes(toggled(lanes, k))}
                      className="flex items-center gap-2.5 w-full text-left rounded px-1 py-0.5 hover:bg-bg-elev-2"
                    >
                      <span className="text-xs w-[72px] shrink-0 text-muted">
                        {LANE_LABELS[k]}
                      </span>
                      <span
                        className="h-2.5 rounded-full shrink-0 bg-accent"
                        style={{
                          width: `${Math.max(
                            6,
                            (audit.laneTotals[k] /
                              Math.max(1, Math.max(...Object.values(audit.laneTotals)))) *
                              190,
                          )}px`,
                        }}
                      />
                      <span className="text-xs font-semibold tnum">
                        {audit.laneTotals[k].toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-subtle mb-2 pt-3 border-t border-border-soft">
                  Combinations that occur ({audit.combos.length})
                </div>
                <div className="flex flex-col gap-0.5 max-h-[220px] overflow-y-auto">
                  {audit.combos.map((c) => (
                    <button
                      key={c.key || "none"}
                      type="button"
                      onClick={() => applyCombo(c.key)}
                      className="flex items-center gap-2.5 w-full text-left rounded px-1 py-1 hover:bg-bg-elev-2"
                    >
                      <span className="flex gap-1 shrink-0" aria-hidden="true">
                        <LaneTiles keys={c.key} size={15} />
                      </span>
                      <span
                        className={`text-xs flex-1 min-w-0 truncate ${
                          c.key === "" ? "text-warn-soft-fg font-medium" : "text-muted"
                        }`}
                      >
                        {c.key === ""
                          ? "No lane at all"
                          : [...c.key].map((k) => LANE_LABELS[k as LaneKey]).join(" + ")}
                      </span>
                      <span className="text-xs font-semibold tnum w-[40px] text-right">
                        {c.count.toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Readout + the cleaning toggle, where the sort control used to be */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border-soft">
          <span className="text-base font-semibold tnum">
            {visible.length.toLocaleString()}
          </span>
          <span className="text-[13px] text-muted">members · {readout}</span>
          {anyFilter && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted hover:text-fg underline ml-2"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOnlyFlagged(!onlyFlagged)}
            aria-pressed={onlyFlagged}
            className={`ml-auto flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] border transition-colors ${
              onlyFlagged
                ? "bg-warn-soft-fg text-bg border-warn-soft-fg font-semibold"
                : "bg-bg border-warn-soft-fg/40 text-warn-soft-fg hover:bg-warn-soft-bg/30"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 9v4M12 17v.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            Needs cleaning
            <span className="tnum font-semibold">{audit.flaggedTotal}</span>
          </button>
        </div>
      </div>

      {/* Roster */}
      <div className="rounded-lg border border-border-soft bg-bg-elev overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-[13px]">
            <thead>
              <tr className="bg-bg-elev-2">
                <Th label="Person" k="name" sort={sort} dir={dir} onSort={toggleSort} />
                <th className="text-left px-4 py-2.5 border-b border-border-soft w-[150px]">
                  <span className="text-[10px] uppercase tracking-wider text-subtle font-medium">
                    Lanes
                  </span>
                </th>
                <Th label="#" k="lanes" sort={sort} dir={dir} onSort={toggleSort} width="w-[60px]" />
                <Th label="Last activity" k="days" sort={sort} dir={dir} onSort={toggleSort} width="w-[140px]" />
                <Th label="Connection" k="connection" sort={sort} dir={dir} onSort={toggleSort} width="w-[120px]" />
                <Th label="Worth a look" k="flags" sort={sort} dir={dir} onSort={toggleSort} width="w-[210px]" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted">
                    Nothing matches — which is good news, not an empty page.
                  </td>
                </tr>
              ) : (
                visible.map((r) => <Row key={r.pcoId} r={r} />)
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-bg-elev-2 border-t border-border-soft text-xs text-subtle">
          Click any column header to sort · click it again to reverse
        </div>
      </div>
    </div>
  );
}

function Row({ r }: { r: AuditPersonRow }) {
  const lapsed = r.connection === "inactive" || r.connection === "present";
  return (
    <tr className="border-b border-border-softer hover:bg-bg-elev-2/50">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="w-6 h-6 shrink-0 rounded-full bg-bg-elev-2 border border-border-soft text-[9px] font-semibold flex items-center justify-center text-muted"
          >
            {r.initials}
          </span>
          <a
            href={`/people/${r.pcoId}`}
            className="font-medium text-accent hover:underline truncate"
          >
            {r.fullName}
          </a>
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex gap-1" role="img" aria-label={laneSummary(r)}>
          <LaneTiles keys={LANE_KEYS.filter((k) => r.lanes[k]).join("")} size={20} />
        </div>
      </td>
      <td
        className={`px-4 py-2 tnum ${
          r.laneCount === 0 ? "text-warn-soft-fg font-semibold" : "text-muted"
        }`}
      >
        {r.laneCount}
      </td>
      <td
        className={`px-4 py-2 whitespace-nowrap tnum ${
          lapsed ? "text-warn-soft-fg font-medium" : "text-muted"
        }`}
      >
        {agoLabel(r.daysSince)}
      </td>
      <td className="px-4 py-2">
        {r.connection ? (
          <span
            className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border ${
              r.connection === "inactive"
                ? "bg-warn-soft-bg text-warn-soft-fg border-warn-soft-fg/30"
                : r.connection === "shepherded"
                  ? "bg-accent-soft-bg text-accent border-accent/30"
                  : "bg-bg-elev-2 text-muted border-border-soft"
            }`}
          >
            {CONNECTION_LABELS[r.connection] ?? r.connection}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-xs">
        {r.flags.length ? (
          <span className="inline-flex items-center gap-1.5 text-subtle">
            <span className="truncate">{r.flags.join(" · ")}</span>
            <a
              href={`${PCO_PERSON}${r.pcoId}`}
              target="_blank"
              rel="noreferrer"
              title="Open in Planning Center"
              aria-label={`Open ${r.fullName} in Planning Center`}
              className="text-accent hover:underline inline-flex shrink-0"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
            </a>
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
    </tr>
  );
}

/** Lane identity is the LETTER, never the colour: five hues cannot be made
 *  safe for red-green colourblindness, and blue-vs-purple is its own trap.
 *  Filled vs dashed carries "in the lane" without depending on hue at all. */
function LaneTiles({ keys, size }: { keys: string; size: number }) {
  return (
    <>
      {LANE_KEYS.map((k) => {
        const on = keys.includes(k);
        return (
          <span
            key={k}
            title={`${LANE_LABELS[k]}: ${on ? "yes" : "no"}`}
            style={{ width: size, height: size, fontSize: size <= 16 ? 8 : 9 }}
            className={`rounded font-bold flex items-center justify-center shrink-0 border ${
              on
                ? "bg-accent text-[var(--accent-fg)] border-accent"
                : "border-dashed border-border-soft text-subtle"
            }`}
          >
            {k.toUpperCase()}
          </span>
        );
      })}
    </>
  );
}

function Th({
  label,
  k,
  sort,
  dir,
  onSort,
  width = "",
}: {
  label: string;
  k: SortKey;
  sort: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  width?: string;
}) {
  const on = sort === k;
  return (
    <th
      className={`text-left px-4 py-2.5 border-b border-border-soft ${width}`}
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium ${
          on ? "text-fg font-semibold" : "text-subtle hover:text-fg"
        }`}
      >
        {label}
        <span className={on ? "text-accent" : "opacity-0"} aria-hidden="true">
          {on && dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function Dropdown({
  id,
  label,
  value,
  open,
  setOpen,
  items,
  onToggle,
}: {
  id: string;
  label: string;
  value: string;
  open: boolean;
  setOpen: (v: string | null) => void;
  items: { id: string; label: string; count: number; checked: boolean }[];
  onToggle: (id: string) => void;
}) {
  const isSet = items.some((i) => i.checked);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(open ? null : id)}
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-md border bg-bg px-3 py-1.5 text-[13px] ${
          isSet ? "border-accent ring-1 ring-accent" : "border-border-soft hover:bg-bg-elev-2"
        }`}
      >
        <span className={isSet ? "text-accent" : "text-subtle"}>{label}</span>
        <span className="font-semibold">{value}</span>
        <span className="text-subtle text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-[230px] rounded-lg border border-border-soft bg-bg-elev p-1.5 shadow-xl">
          {items.map((i) => (
            <label
              key={i.id}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer hover:bg-bg-elev-2"
            >
              <input
                type="checkbox"
                checked={i.checked}
                onChange={() => onToggle(i.id)}
                className="accent-[var(--accent)] w-3.5 h-3.5"
              />
              <span className="text-[13px] flex-1">{i.label}</span>
              <span className="text-[11px] text-subtle tnum">
                {i.count.toLocaleString()}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function laneSummary(r: AuditPersonRow): string {
  const names = LANE_KEYS.filter((k) => r.lanes[k]).map((k) => LANE_LABELS[k]);
  return names.length ? `In ${names.join(", ")}` : "In no lane";
}

function toggled<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function phraseBands(bands: Set<number>): string {
  const vs = [...bands].sort((a, b) => a - b);
  if (vs.length === 1) {
    return vs[0] === 0 ? "no lane" : `${vs[0]} lane${vs[0] === 1 ? "" : "s"}`;
  }
  const named = vs.map((v) => (v === 0 ? "no lane" : String(v)));
  const last = named.pop();
  return `${named.join(", ")} or ${last} lanes`;
}
