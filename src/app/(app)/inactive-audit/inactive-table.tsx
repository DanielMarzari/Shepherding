"use client";

import { useMemo, useState } from "react";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/SortableTable";
import { FilterDropdown } from "@/components/FilterDropdown";
import type { InactiveCandidate } from "@/lib/inactive-audit";

/** The candidates, longest-unseen first.
 *
 *  Sorted so the people who have only just gone quiet are at the bottom
 *  and the ones nobody has seen in years are at the top: the longer the
 *  gap the safer the call, and a list you work from the top of should
 *  start with the easy ones.
 */
const LANE_LABEL: Record<string, string> = {
  w: "Worship",
  s: "Serve",
  c: "Community",
  g: "Give",
  o: "Outreach",
};
const LANE_KEYS = ["w", "s", "c", "g", "o"] as const;

const NEVER = "never";

/** How long since — for a list where everybody is past a year already, so
 *  the buckets start there rather than at "last 30 days". The first one
 *  has no floor, so a date just inside the window still lands somewhere. */
const SINCE_BUCKETS: { id: string; label: string; maxDays: number | null }[] = [
  { id: "2", label: "Under 2 years", maxDays: 730 },
  { id: "5", label: "2 to 5 years", maxDays: 1826 },
  { id: "10", label: "5 to 10 years", maxDays: 3652 },
  { id: "old", label: "Over 10 years", maxDays: null },
];

function sinceBucket(days: number | null): string {
  if (days === null) return NEVER;
  for (const b of SINCE_BUCKETS) if (b.maxDays === null || days < b.maxDays) return b.id;
  return "old";
}

/** The household's most recent sign of life, from anyone else in it.
 *  These buckets run the other way — the useful question is whether
 *  somebody in the house was seen recently. */
const NO_HOUSEHOLD = "none";
const HOUSEHOLD_BUCKETS: { id: string; label: string; maxDays: number | null }[] = [
  { id: "90", label: "Last 3 months", maxDays: 91 },
  { id: "365", label: "3 months to a year", maxDays: 365 },
  { id: "old", label: "Over a year", maxDays: null },
];

function householdBucket(r: InactiveCandidate): string {
  if (r.household.length === 0) return NO_HOUSEHOLD;
  const seen = r.household
    .map((h) => h.daysSince)
    .filter((d): d is number => d !== null);
  if (seen.length === 0) return NEVER;
  const days = Math.min(...seen);
  for (const b of HOUSEHOLD_BUCKETS) if (b.maxDays === null || days < b.maxDays) return b.id;
  return "old";
}

/** On a roster: a lane or the shepherded band both mean somebody is
 *  formally connected to them and has still not seen them. */
const onRoster = (r: InactiveCandidate) =>
  r.laneCount > 0 || r.classification === "shepherded";

/** "2y 4m", "7m", "12d", "never" — the same short form in every date
 *  column. Days under a month: a housemate seen last week is "6d", not "0m". */
function ago(days: number | null): string {
  if (days === null) return "never";
  if (days < 30) return `${days}d`;
  if (days >= 365) return `${Math.floor(days / 365)}y ${Math.floor((days % 365) / 30)}m`;
  return `${Math.floor(days / 30)}m`;
}

/** Counts per option over the whole list, so a dropdown's numbers stay put
 *  while you narrow — a count that moves as you filter reads as a bug. */
function tally(rows: InactiveCandidate[], key: (r: InactiveCandidate) => string) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const toggled = (set: Set<string>, v: string) => {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
};

export function InactiveTable({
  rows,
  months,
  types,
}: {
  rows: InactiveCandidate[];
  months: number;
  types: { type: string; n: number }[];
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [type, setType] = useState<Set<string>>(new Set());
  const [roster, setRoster] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [via, setVia] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState<Set<string>>(new Set());
  const [house, setHouse] = useState<Set<string>>(new Set());

  const counts = useMemo(
    () => ({
      roster: tally(rows, (r) => (onRoster(r) ? "yes" : "no")),
      seen: tally(rows, (r) => sinceBucket(r.daysSince)),
      via: tally(rows, (r) => r.lastSeenVia ?? NEVER),
      email: tally(rows, (r) => sinceBucket(r.emailDaysSince)),
      house: tally(rows, householdBucket),
    }),
    [rows],
  );

  const anyFilter =
    type.size > 0 || roster.size > 0 || seen.size > 0 || via.size > 0 || email.size > 0 || house.size > 0;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (type.size && !type.has(r.membershipType ?? "(unset)")) return false;
      if (roster.size && !roster.has(onRoster(r) ? "yes" : "no")) return false;
      if (seen.size && !seen.has(sinceBucket(r.daysSince))) return false;
      if (via.size && !via.has(r.lastSeenVia ?? NEVER)) return false;
      if (email.size && !email.has(sinceBucket(r.emailDaysSince))) return false;
      if (house.size && !house.has(householdBucket(r))) return false;
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, type, roster, seen, via, email, house]);

  const value = (set: Set<string>, label: (id: string) => string) =>
    set.size ? [...set].map(label).join(" or ") : "any";
  const sinceLabel = (id: string) =>
    id === NEVER ? "Never" : (SINCE_BUCKETS.find((b) => b.id === id)?.label ?? id);
  const houseLabel = (id: string) =>
    id === NO_HOUSEHOLD
      ? "No other adults"
      : id === NEVER
        ? "Nothing recorded"
        : (HOUSEHOLD_BUCKETS.find((b) => b.id === id)?.label ?? id);
  const sinceItems = (set: Set<string>, n: Record<string, number>) =>
    [...SINCE_BUCKETS.map((b) => b.id), NEVER]
      .map((id) => ({ id, label: sinceLabel(id), count: n[id] ?? 0, checked: set.has(id) }))
      .filter((i) => i.count > 0);

  const columns: SortableColumn<InactiveCandidate>[] = [
    {
      key: "name",
      label: "Person",
      align: "left",
      className: "w-auto",
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <a href={`/people/${r.personId}`} className="font-medium hover:text-accent">
          {r.name}
        </a>
      ),
    },
    {
      key: "type",
      label: "Membership",
      align: "left",
      className: "w-[140px]",
      sortValue: (r) => r.membershipType ?? "~",
      render: (r) => (
        <span className="text-xs text-muted">{r.membershipType ?? "—"}</span>
      ),
    },
    {
      key: "lanes",
      label: "Lanes",
      align: "left",
      className: "w-[130px]",
      title:
        "Worship, Serve, Community, Give, Outreach — where they are on a roster today. A lane here needs no attendance: connected on paper, absent in fact.",
      sortValue: (r) => r.laneCount,
      render: (r) =>
        r.laneCount === 0 ? (
          <span className="text-subtle text-xs">—</span>
        ) : (
          <span className="flex gap-1">
            {LANE_KEYS.filter((k) => r.lanes[k]).map((k) => (
              <span
                key={k}
                title={LANE_LABEL[k]}
                className="w-5 h-5 rounded border border-warn-soft-fg/50 text-warn-soft-fg text-[10px] font-bold flex items-center justify-center"
              >
                {LANE_LABEL[k][0]}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: "via",
      label: "Last trace",
      align: "left",
      className: "w-[150px]",
      title: "The kind of record that last showed them — what Last seen is the date of.",
      sortValue: (r) => r.lastSeenVia ?? "~",
      render: (r) => (
        <span className="text-xs text-muted">
          {r.lastSeenVia ?? (
            <span className="text-subtle italic">nothing, ever</span>
          )}
        </span>
      ),
    },
    {
      key: "when",
      label: "Last seen",
      align: "right",
      className: "w-[100px] whitespace-nowrap",
      // Null sorts last by the table's own rule, which is wrong here: never
      // seen at all is the longest gap there is, so it is given a number
      // past any real one.
      sortValue: (r) => r.daysSince ?? 1_000_000,
      render: (r) => (
        <span
          className="text-xs tnum text-muted whitespace-nowrap"
          title={r.lastSeenAt ? r.lastSeenAt.slice(0, 10) : "no record of anything"}
        >
          {ago(r.daysSince)}
        </span>
      ),
    },
    {
      key: "email",
      label: "Email opened",
      align: "right",
      className: "w-[120px] whitespace-nowrap",
      title: "When they last opened or clicked one of the church's emails",
      sortValue: (r) => r.emailDaysSince ?? 1_000_000,
      render: (r) => (
        <span
          className={`text-xs tnum whitespace-nowrap ${r.emailDaysSince === null ? "text-subtle" : "text-muted"}`}
          title={r.lastEmailAt ? r.lastEmailAt.slice(0, 10) : "never opened one"}
        >
          {ago(r.emailDaysSince)}
        </span>
      ),
    },
    {
      key: "house",
      label: "Household",
      align: "left",
      className: "w-[200px]",
      title: "The other adults in their household, and when each was last seen — any trace, from any source",
      // Most recently seen housemate first; no household sorts last.
      sortValue: (r) => {
        const d = r.household
          .map((h) => h.daysSince)
          .filter((x): x is number => x !== null);
        return d.length ? Math.min(...d) : r.household.length ? 1_000_000 : null;
      },
      render: (r) =>
        r.household.length === 0 ? (
          <span className="text-subtle text-xs">—</span>
        ) : (
          <div className="space-y-1.5 text-xs">
            {r.household.map((h) => (
              <div key={h.personId} className="leading-snug">
                <a href={`/people/${h.personId}`} className="hover:text-accent block truncate">
                  {h.name}
                </a>
                <span
                  className="text-subtle tnum block"
                  title={h.lastSeenAt ? `Last seen ${h.lastSeenAt.slice(0, 10)}` : "Nothing recorded"}
                >
                  {h.daysSince === null ? "never seen" : `seen ${ago(h.daysSince)} ago`}
                </span>
              </div>
            ))}
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-3" onClick={() => setOpen(null)}>
      <div className="rounded-lg border border-border-soft bg-bg-elev px-4 py-3 flex flex-wrap items-center gap-2">
        <FilterDropdown
          id="type"
          label="Membership"
          value={value(type, (t) => t)}
          open={open === "type"}
          setOpen={setOpen}
          items={types.map((t) => ({
            id: t.type,
            label: t.type,
            count: t.n,
            checked: type.has(t.type),
          }))}
          onToggle={(id) => setType(toggled(type, id))}
        />
        <FilterDropdown
          id="seen"
          label="Last seen"
          value={value(seen, sinceLabel)}
          open={open === "seen"}
          setOpen={setOpen}
          items={sinceItems(seen, counts.seen)}
          onToggle={(id) => setSeen(toggled(seen, id))}
        />
        <FilterDropdown
          id="via"
          label="Last trace"
          value={value(via, (v) => (v === NEVER ? "Nothing, ever" : v))}
          open={open === "via"}
          setOpen={setOpen}
          items={Object.entries(counts.via)
            .sort((a, b) => b[1] - a[1])
            .map(([id, n]) => ({
              id,
              label: id === NEVER ? "Nothing, ever" : id,
              count: n,
              checked: via.has(id),
            }))}
          onToggle={(id) => setVia(toggled(via, id))}
        />
        <FilterDropdown
          id="email"
          label="Email opened"
          value={value(email, sinceLabel)}
          open={open === "email"}
          setOpen={setOpen}
          items={sinceItems(email, counts.email)}
          onToggle={(id) => setEmail(toggled(email, id))}
        />
        <FilterDropdown
          id="house"
          label="Household activity"
          value={value(house, houseLabel)}
          open={open === "house"}
          setOpen={setOpen}
          items={[...HOUSEHOLD_BUCKETS.map((b) => b.id), NEVER, NO_HOUSEHOLD]
            .map((id) => ({
              id,
              label: houseLabel(id),
              count: counts.house[id] ?? 0,
              checked: house.has(id),
            }))
            .filter((i) => i.count > 0)}
          onToggle={(id) => setHouse(toggled(house, id))}
        />
        <FilterDropdown
          id="roster"
          label="Roster"
          value={value(roster, (v) => (v === "yes" ? "On a roster anyway" : "On no roster"))}
          open={open === "roster"}
          setOpen={setOpen}
          items={[
            { id: "yes", label: "On a roster anyway", count: counts.roster.yes ?? 0, checked: roster.has("yes") },
            { id: "no", label: "On no roster", count: counts.roster.no ?? 0, checked: roster.has("no") },
          ].filter((i) => i.count > 0)}
          onToggle={(id) => setRoster(toggled(roster, id))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a name…"
          aria-label="Find a name"
          className="bg-bg-elev border border-border-soft rounded px-3 py-1.5 text-[13px] w-full max-w-xs"
        />
        {anyFilter && (
          <button
            type="button"
            onClick={() => {
              setType(new Set());
              setRoster(new Set());
              setSeen(new Set());
              setVia(new Set());
              setEmail(new Set());
              setHouse(new Set());
            }}
            className="text-xs text-accent hover:underline cursor-pointer"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-subtle tnum ml-auto">
          {shown.length.toLocaleString()} of {rows.length.toLocaleString()}
        </span>
        <button
          type="button"
          onClick={() => exportCsv(shown, months)}
          disabled={shown.length === 0}
          className="px-3 py-1.5 rounded border border-border-soft text-xs hover:bg-bg-elev-2 cursor-pointer disabled:opacity-50"
        >
          Export this list
        </button>
      </div>

      <SortableTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r.personId}
        initialSortKey="when"
        initialSortDir="desc"
        emptyMessage="Nobody matches that."
        tableClassName="table-fixed min-w-[1040px]"
      />
    </div>
  );
}

function exportCsv(rows: InactiveCandidate[], months: number) {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [
    [
      "Name",
      "Membership",
      "Lanes",
      "Band",
      "Last trace",
      "Last seen",
      "Days since last seen",
      "Email opened",
      "Household",
      "PCO link",
    ]
      .map(cell)
      .join(","),
  ];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.membershipType ?? "",
        LANE_KEYS.filter((k) => r.lanes[k]).map((k) => LANE_LABEL[k]).join(" "),
        r.classification,
        r.lastSeenVia ?? "nothing ever",
        r.lastSeenAt ? r.lastSeenAt.slice(0, 10) : "",
        r.daysSince ?? "",
        r.lastEmailAt ? r.lastEmailAt.slice(0, 10) : "",
        r.household
          .map((h) => `${h.name}: ${h.lastSeenAt ? `seen ${h.lastSeenAt.slice(0, 10)}` : "never seen"}`)
          .join("; "),
        `https://people.planningcenteronline.com/people/${r.personId}`,
      ]
        .map(cell)
        .join(","),
    );
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `inactive-candidates-${months}m.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
