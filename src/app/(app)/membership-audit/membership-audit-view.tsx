"use client";

import { useMemo, useState } from "react";
import {
  ACTIVITY_BUCKETS,
  CLASSIFICATIONS,
  CLASS_LABEL,
  classOf,
  FLAG_TYPES,
  LANE_KEYS,
  LANE_LABELS,
  NEVER_BUCKET,
  type AuditPersonRow,
  type LaneKey,
  type Classification,
  type MembershipAudit,
  agoLabel,
} from "@/lib/membership-audit-shared";

const PCO_PERSON = "https://people.planningcenteronline.com/people/";

/** The coverage strip's bands. Lightness climbs with lane count and the
 *  "no lane" band is the one warm colour on the page, so the shape reads
 *  without relying on hue — amber vs blues differ in lightness too. */
const BAND_STYLE = [
  { bg: "var(--warn-soft-bg)", fg: "var(--warn-soft-fg)" },
  { bg: "color-mix(in srgb, var(--accent) 14%, transparent)", fg: "var(--fg)" },
  { bg: "color-mix(in srgb, var(--accent) 30%, transparent)", fg: "var(--fg)" },
  { bg: "color-mix(in srgb, var(--accent) 48%, transparent)", fg: "var(--fg)" },
  { bg: "color-mix(in srgb, var(--accent) 70%, transparent)", fg: "var(--accent-fg)" },
  { bg: "var(--accent)", fg: "var(--accent-fg)" },
];

type SortKey = "name" | "lanes" | "days" | "connection" | "flags";

export function MembershipAuditView({ audit }: { audit: MembershipAudit }) {
  const [lanes, setLanes] = useState<Set<LaneKey>>(new Set());
  const [bands, setBands] = useState<Set<number>>(new Set());
  const [connections, setConnections] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<Set<string>>(new Set());
  const [activity, setActivity] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  // Exactly one of the two reference panels can be open. They sit between
  // the filter card and the table rather than floating over it: both are
  // things you read while looking at the numbers, not menus you dismiss.
  const [panel, setPanel] = useState<"bylane" | "legend" | null>(null);
  // Opens sorted by name. Longest-silence-first is the better worklist
  // order, but it made the page look like a list of problems before you
  // had asked it anything; the column header is one click away.
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  // "count" = commonest first; "lanes" = W S C G O bit order, so every
  // combination containing Worship groups together, then Serve, and so on.
  const [comboSort, setComboSort] = useState<"count" | "lanes">("count");

  const anyFilter =
    lanes.size > 0 ||
    bands.size > 0 ||
    connections.size > 0 ||
    warnings.size > 0 ||
    activity.size > 0;

  /** How many rows carry each warning, and how many fall in each activity
   *  bucket. Computed off the unfiltered roster so the dropdown counts stay
   *  put while you narrow — a count that moves as you filter reads as a bug. */
  const warningTotals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of audit.rows) for (const f of r.flags) out[f] = (out[f] ?? 0) + 1;
    return out;
  }, [audit.rows]);

  const activityTotals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of audit.rows) {
      const id = bucketOf(r.daysSince);
      out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }, [audit.rows]);

  const visible = useMemo(() => {
    const out = audit.rows.filter((r) => {
      for (const k of lanes) if (!r.lanes[k]) return false;
      if (bands.size && !bands.has(r.laneCount)) return false;
      if (connections.size && !connections.has(classOf(r.connection))) return false;
      if (warnings.size && !r.flags.some((f) => warnings.has(f))) return false;
      if (activity.size && !activity.has(bucketOf(r.daysSince))) return false;
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
            (CLASSIFICATIONS.indexOf(classOf(a.connection)) -
              CLASSIFICATIONS.indexOf(classOf(b.connection))) * sign
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
  }, [audit.rows, lanes, bands, connections, warnings, activity, sort, dir]);

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
    setWarnings(new Set());
    setActivity(new Set());
  }

  function applyCombo(key: string) {
    const next = new Set<LaneKey>();
    for (const ch of key) next.add(ch as LaneKey);
    setLanes(next);
    setBands(key === "" ? new Set([0]) : new Set());
    setOpen(null);
  }

  const sortedCombos = useMemo(() => {
    const list = audit.combos.slice();
    if (comboSort === "count") return list;
    // Bit order with Worship highest, so sorting descending groups every
    // W combination first, then S, and so on — 10000, 01000, 00100…
    const mask = (k: string) =>
      LANE_KEYS.reduce(
        (acc, lane, i) =>
          acc + (k.includes(lane) ? 1 << (LANE_KEYS.length - 1 - i) : 0),
        0,
      );
    return list.sort((a, b) => mask(b.key) - mask(a.key));
  }, [audit.combos, comboSort]);

  const readout = (() => {
    const bits: string[] = [];
    if (bands.size) bits.push(`in ${phraseBands(bands)}`);
    if (lanes.size)
      bits.push(
        `including ${[...lanes].map((k) => LANE_LABELS[k]).join(" + ")}`,
      );
    if (connections.size)
      bits.push([...connections].map((c) => CLASS_LABEL[c as Classification]).join(" or "));
    if (warnings.size) bits.push([...warnings].join(" or ").toLowerCase());
    if (activity.size)
      bits.push(
        [...activity]
          .map((id) => labelForBucket(id).toLowerCase())
          .join(" or "),
      );
    return bits.length ? bits.join(" · ") : "everything";
  })();

  return (
    <div
      className="space-y-4"
      onClick={() => {
        setOpen(null);
        setPanel(null);
      }}
    >
      <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-4 space-y-3">
        {/* Coverage strip. Read-only on purpose: it is a picture of the
            shape, and the "Lanes active" dropdown is the filter. Making it
            both meant a click could silently narrow the table while you
            were only trying to read it.

            Each band is named directly above itself. The right-hand bands
            are too narrow to sit a label over — 5 lanes is 30 of 1,078,
            about 24px — so those labels lift slightly and drop a leader
            line onto their band rather than tilting to fit. */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle mb-1.5">
            Lanes per member
          </div>
          <div className="relative h-10">
            {(() => {
              let acc = 0;
              return audit.bandTotals.map((n, i) => {
                if (n === 0) return null;
                const w = (n / Math.max(1, audit.total)) * 100;
                const mid = acc + w / 2;
                acc += w;
                const tight = w < 9;
                return (
                  <span
                    key={i}
                    style={{ left: `${mid}%` }}
                    className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center"
                  >
                    <span className="text-[11px] font-medium text-muted whitespace-nowrap">
                      {bandName(i)}
                    </span>
                    {tight && (
                      <span
                        aria-hidden="true"
                        className="w-px h-3 bg-border-soft"
                      />
                    )}
                  </span>
                );
              });
            })()}
          </div>
          <div
            role="img"
            aria-label={audit.bandTotals
              .map((n, i) => (n === 0 ? null : `${n} ${bandName(i)}`))
              .filter(Boolean)
              .join(", ")}
            className="flex h-8 rounded-md overflow-hidden border border-border-soft"
          >
            {audit.bandTotals.map((n, i) => {
              if (n === 0) return null;
              const w = (n / Math.max(1, audit.total)) * 100;
              const st = BAND_STYLE[i];
              return (
                <div
                  key={i}
                  style={{ width: `${w}%`, background: st.bg, color: st.fg }}
                  className="flex items-center justify-center text-[11px] font-bold tnum overflow-hidden"
                >
                  {w >= 5 ? n.toLocaleString() : ""}
                </div>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-subtle">
              Lanes
            </span>
            <div className="flex gap-1">
              {LANE_KEYS.map((k) => {
                const on = lanes.has(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setLanes(toggled(lanes, k))}
                    aria-pressed={on}
                    title={`${LANE_LABELS[k]} — ${audit.laneTotals[k].toLocaleString()} members`}
                    className={`w-7 h-7 rounded font-bold text-[11px] flex items-center justify-center border transition-colors ${
                      on
                        ? "bg-accent text-[var(--accent-fg)] border-accent"
                        : "border-dashed border-border-soft text-subtle hover:text-fg hover:border-fg/40"
                    }`}
                  >
                    {k.toUpperCase()}
                    <span className="sr-only">
                      {" "}
                      {LANE_LABELS[k]}, {audit.laneTotals[k]} members
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <Dropdown
            id="bands"
            label="Lanes active"
            value={bands.size ? phraseBands(bands) : "any"}
            open={open === "bands"}
            setOpen={setOpen}
            items={audit.bandTotals
              .map((n, i) => ({ n, i }))
              .filter((b) => b.n > 0)
              .map((b) => ({
                id: String(b.i),
                label:
                  b.i === 0 ? "In no lane" : `${b.i} lane${b.i === 1 ? "" : "s"}`,
                count: b.n,
                checked: bands.has(b.i),
              }))}
            onToggle={(id) => setBands(toggled(bands, Number(id)))}
          />
          <Dropdown
            id="activity"
            label="Last activity"
            value={
              activity.size
                ? [...activity].map(labelForBucket).join(" or ")
                : "any"
            }
            open={open === "activity"}
            setOpen={setOpen}
            items={[
              ...ACTIVITY_BUCKETS.map((b) => ({
                id: b.id,
                label: b.label,
                count: activityTotals[b.id] ?? 0,
                checked: activity.has(b.id),
              })),
              {
                id: NEVER_BUCKET,
                label: "Never active",
                count: activityTotals[NEVER_BUCKET] ?? 0,
                checked: activity.has(NEVER_BUCKET),
              },
            ].filter((i) => i.count > 0)}
            onToggle={(id) => setActivity(toggled(activity, id))}
          />
          <Dropdown
            id="connection"
            label="Connection"
            value={
              connections.size
                ? [...connections].map((c) => CLASS_LABEL[c as Classification]).join(" or ")
                : "any"
            }
            open={open === "connection"}
            setOpen={setOpen}
            items={CLASSIFICATIONS.filter(
              (b: Classification) => (audit.bandTotalsByName[b] ?? 0) > 0,
            ).map((b: Classification) => ({
              id: b,
              label: CLASS_LABEL[b],
              count: audit.bandTotalsByName[b] ?? 0,
              checked: connections.has(b),
            }))}
            onToggle={(id) => setConnections(toggled(connections, id))}
          />

          <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <PanelButton
              label="See by lane"
              active={panel === "bylane"}
              onClick={() => setPanel(panel === "bylane" ? null : "bylane")}
            />
            <PanelButton
              label="How is activity measured?"
              active={panel === "legend"}
              onClick={() => setPanel(panel === "legend" ? null : "legend")}
            />
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
          <div className="ml-auto flex items-center gap-2">
            <WarningsDropdown
              open={open === "warnings"}
              setOpen={setOpen}
              totals={warningTotals}
              selected={warnings}
              onToggle={(f) => setWarnings(toggled(warnings, f))}
              anyTotal={audit.flaggedTotal}
            />
            <button
              type="button"
              onClick={() => exportRows(visible, audit.membershipType)}
              className="flex items-center gap-2 rounded-md border border-border-soft bg-bg px-3 py-1.5 text-[13px] hover:bg-bg-elev-2"
              title="Downloads exactly the rows showing now, with the filters applied"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
              </svg>
              Export
              <span className="tnum text-subtle">{visible.length.toLocaleString()}</span>
            </button>
          </div>
        </div>
      </div>

      {/* One expanding reference block, between the filters and the table */}
      {panel !== null && (
        <div
          className="rounded-lg border border-accent/40 bg-bg-elev px-5 py-4"
          onClick={(e) => e.stopPropagation()}
        >
          {panel === "bylane" ? (
            <ByLanePanel
              audit={audit}
              comboSort={comboSort}
              setComboSort={setComboSort}
              sortedCombos={sortedCombos}
              lanes={lanes}
              onToggleLane={(k) => setLanes(toggled(lanes, k))}
              onPickCombo={applyCombo}
            />
          ) : (
            <LaneLegend activityMonths={audit.activityMonths} />
          )}
        </div>
      )}

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

/** What actually lights each lane. Written out because "Worship" sounds
 *  like Sunday attendance and is not — adults rarely check in, so the lane
 *  leans on event attendance and serving. Anyone reading a number off this
 *  page deserves to know what it counts before they act on it. */
function LaneLegend({ activityMonths }: { activityMonths: number }) {
  const rows: { k: LaneKey; what: string }[] = [
    {
      k: "w",
      what:
        "Attended a group meeting or event that was marked attended, or was scheduled (and did not decline) on a service plan.",
    },
    {
      k: "s",
      what:
        "Currently on a serving team roster in PCO Services. Archived teams do not count; team types you excluded in Filters do not either.",
    },
    {
      k: "c",
      what:
        "Currently a member of a group that is still running. A membership in an archived group is history, not community.",
    },
    { k: "g", what: "Has a gift on record in the PushPay import." },
    {
      k: "o",
      what:
        "Holds a Services tag, is on a team, or is in a group that you marked as outreach in Filters. Nothing else infers it.",
    },
  ];
  return (
    <div>
      <h2 className="text-[11px] uppercase tracking-wider text-subtle font-medium mb-3">
        What lights up each lane
      </h2>
      <dl className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.k} className="flex gap-3 items-baseline">
            <dt className="shrink-0 flex items-center gap-2 w-[112px]">
              <span
                aria-hidden="true"
                className="w-5 h-5 rounded bg-accent text-[var(--accent-fg)] text-[9px] font-bold flex items-center justify-center"
              >
                {r.k.toUpperCase()}
              </span>
              <span className="text-[13px] font-medium">{LANE_LABELS[r.k]}</span>
            </dt>
            <dd className="text-[13px] text-muted leading-relaxed">{r.what}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-subtle mt-4 pt-3 border-t border-border-soft leading-relaxed">
        All five look back over your activity window of{" "}
        <strong className="text-muted">{activityMonths} months</strong>, set in{" "}
        <a href="/pco" className="text-accent hover:underline">
          Sync settings
        </a>
        . <strong className="text-muted">Last activity</strong> is the most
        recent of: group or event attendance, serving on a plan, a check-in, a
        form submission, a gift, or an edit to the PCO record itself.
      </p>
      <p className="text-xs text-subtle mt-2 leading-relaxed">
        Two caveats worth holding onto. Adults rarely check themselves in, so
        Worship under-counts Sunday attendance badly — it is not a headcount.
        And the gift history currently loaded only covers 2026, so Give cannot
        yet tell a lapsed giver from a new one.
      </p>
    </div>
  );
}

function Row({ r }: { r: AuditPersonRow }) {
  const lapsed = classOf(r.connection) === "unknown";
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
              classOf(r.connection) === "unknown"
                ? "bg-warn-soft-bg text-warn-soft-fg border-warn-soft-fg/30"
                : classOf(r.connection) === "shepherded"
                  ? "bg-accent-soft-bg text-accent border-accent/30"
                  : "bg-bg-elev-2 text-muted border-border-soft"
            }`}
          >
            {CLASS_LABEL[classOf(r.connection)]}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-xs">
        {r.flags.length ? (
          <span className="inline-flex items-center gap-1.5 text-subtle">
            <span className="truncate">
              {r.flags
                .map((f) =>
                  f === "Possible duplicate" && r.duplicateOf.length
                    ? `Duplicate of ${r.duplicateOf.map((d) => d.name).join(", ")}`
                    : f,
                )
                .join(" · ")}
            </span>
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

/** A toggle for one of the two reference panels. Reads as pressed while
 *  its panel is open, so it is obvious which button opened the block. */
function PanelButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] transition-colors ${
        active
          ? "border-accent bg-accent-soft-bg text-accent font-medium"
          : "border-border-soft bg-bg text-accent hover:bg-bg-elev-2"
      }`}
    >
      {label}
      <span className="text-subtle text-xs" aria-hidden="true">
        {active ? "\u25B4" : "\u25BE"}
      </span>
    </button>
  );
}

/** Per-lane totals and every combination that occurs. Laid out in two
 *  columns because as a single list it ran past the fold on a laptop. */
function ByLanePanel({
  audit,
  comboSort,
  setComboSort,
  sortedCombos,
  lanes,
  onToggleLane,
  onPickCombo,
}: {
  audit: MembershipAudit;
  comboSort: "count" | "lanes";
  setComboSort: (v: "count" | "lanes") => void;
  sortedCombos: { key: string; count: number }[];
  lanes: Set<LaneKey>;
  onToggleLane: (k: LaneKey) => void;
  onPickCombo: (key: string) => void;
}) {
  const widest = Math.max(1, ...Object.values(audit.laneTotals));
  const commonest = Math.max(1, ...sortedCombos.map((c) => c.count));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-x-10 gap-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-subtle mb-2.5">
          Members in each lane
        </div>
        <div className="flex flex-col gap-1.5">
          {LANE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onToggleLane(k)}
              aria-pressed={lanes.has(k)}
              className={`flex items-center gap-2.5 w-full text-left rounded px-1 py-0.5 hover:bg-bg-elev-2 ${
                lanes.has(k) ? "text-accent font-medium" : ""
              }`}
            >
              <span className="text-xs w-[72px] shrink-0 text-muted">
                {LANE_LABELS[k]}
              </span>
              <span
                className="h-2.5 rounded-full shrink-0 bg-accent"
                style={{
                  width: `${Math.max(6, (audit.laneTotals[k] / widest) * 120)}px`,
                }}
              />
              <span className="text-xs font-semibold tnum">
                {audit.laneTotals[k].toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="text-[10px] uppercase tracking-wider text-subtle">
            Combinations that occur ({audit.combos.length})
          </span>
          <span className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setComboSort("count")}
              className={
                comboSort === "count"
                  ? "text-accent font-semibold"
                  : "text-subtle hover:text-fg"
              }
            >
              by number
            </button>
            <span className="text-subtle">·</span>
            <button
              type="button"
              onClick={() => setComboSort("lanes")}
              className={
                comboSort === "lanes"
                  ? "text-accent font-semibold"
                  : "text-subtle hover:text-fg"
              }
            >
              by lane
            </button>
          </span>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-0.5 max-h-[260px] overflow-y-auto">
          {sortedCombos.map((c) => (
            <button
              key={c.key || "none"}
              type="button"
              onClick={() => onPickCombo(c.key)}
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
              <span
                className="h-1.5 rounded-full shrink-0"
                style={{
                  width: `${Math.max(6, (c.count / commonest) * 56)}px`,
                  background:
                    c.key === "" ? "var(--warn-soft-fg)" : "var(--accent)",
                }}
              />
              <span className="text-xs font-semibold tnum w-[40px] text-right">
                {c.count.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The warnings filter. Styled apart from the other dropdowns because it
 *  is a different kind of question — records to fix in PCO, not people to
 *  pastor — and it keeps the amber it had as a button. */
function WarningsDropdown({
  open,
  setOpen,
  totals,
  selected,
  onToggle,
  anyTotal,
}: {
  open: boolean;
  setOpen: (v: string | null) => void;
  totals: Record<string, number>;
  selected: Set<string>;
  onToggle: (f: string) => void;
  anyTotal: number;
}) {
  const present = FLAG_TYPES.filter((f) => (totals[f] ?? 0) > 0);
  const isSet = selected.size > 0;
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(open ? null : "warnings")}
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] border transition-colors ${
          isSet
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
        Worth a look
        <span className="tnum font-semibold">
          {isSet ? selected.size : anyTotal}
        </span>
        <span className="text-xs opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[250px] rounded-lg border border-border-soft bg-bg-elev p-1.5 shadow-xl">
          {present.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted text-center">
              No records need cleaning.
            </div>
          ) : (
            present.map((f) => (
              <label
                key={f}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer hover:bg-bg-elev-2"
              >
                <input
                  type="checkbox"
                  checked={selected.has(f)}
                  onChange={() => onToggle(f)}
                  className="accent-[var(--accent)] w-3.5 h-3.5"
                />
                <span className="text-[13px] flex-1">{f}</span>
                <span className="text-[11px] text-subtle tnum">
                  {(totals[f] ?? 0).toLocaleString()}
                </span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Which activity bucket a row falls in. One place, so the dropdown counts
 *  and the filter can never disagree. */
function bucketOf(days: number | null): string {
  if (days === null) return NEVER_BUCKET;
  for (const b of ACTIVITY_BUCKETS) {
    if (days >= b.minDays && (b.maxDays === null || days < b.maxDays)) return b.id;
  }
  return ACTIVITY_BUCKETS[ACTIVITY_BUCKETS.length - 1].id;
}

function labelForBucket(id: string): string {
  if (id === NEVER_BUCKET) return "Never active";
  return ACTIVITY_BUCKETS.find((b) => b.id === id)?.label ?? id;
}

/** Export exactly what is on screen, filters and sort order included —
 *  the point of the button is to hand someone the list you are looking at,
 *  not the whole roster again. */
function exportRows(rows: AuditPersonRow[], membershipType: string) {
  const header = [
    "Name",
    ...LANE_KEYS.map((k) => LANE_LABELS[k]),
    "Lanes active",
    "Last activity",
    "Connection",
    "Worth a look",
    "PCO link",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.fullName,
        ...LANE_KEYS.map((k) => (r.lanes[k] ? "yes" : "")),
        String(r.laneCount),
        agoLabel(r.daysSince),
        CLASS_LABEL[classOf(r.connection)],
        r.flags.join("; "),
        `${PCO_PERSON}${r.pcoId}`,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `membership-audit-${membershipType.toLowerCase().replace(/\s+/g, "-")}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "In no lane", "1 lane", "2 lanes"… Spelled out in the key rather than
 *  left to a tooltip, because the narrow bands cannot carry a label. */
function bandName(i: number): string {
  if (i === 0) return "In no lane";
  return `${i} lane${i === 1 ? "" : "s"}`;
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
