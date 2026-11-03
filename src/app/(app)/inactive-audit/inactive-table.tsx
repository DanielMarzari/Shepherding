"use client";

import { useMemo, useState } from "react";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/SortableTable";
import type { InactiveCandidate } from "@/lib/inactive-audit";

/** The candidates, newest-silence first.
 *
 *  Sorted so the people who have only just gone quiet are at the bottom
 *  and the ones nobody has seen in years are at the top: the longer the
 *  silence the safer the call, and a list you work from the top of should
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
  const [onlyNever, setOnlyNever] = useState(false);
  const [onlyRoster, setOnlyRoster] = useState(false);
  const [type, setType] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyNever && r.lastSeenAt !== null) return false;
      // On a roster: a lane or the shepherded band both mean somebody is
      // formally connected to them and has still not seen them.
      if (onlyRoster && r.laneCount === 0 && r.classification !== "shepherded")
        return false;
      if (type && (r.membershipType ?? "(unset)") !== type) return false;
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, onlyNever, onlyRoster, type]);

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
      className: "w-[160px]",
      sortValue: (r) => r.membershipType ?? "~",
      render: (r) => (
        <span className="text-xs text-muted">{r.membershipType ?? "—"}</span>
      ),
    },
    {
      key: "lanes",
      label: "Lanes",
      align: "left",
      className: "w-[160px]",
      title:
        "Worship, Serve, Community, Give, Outreach. A lane here comes from a roster, which needs no attendance — connected on paper, absent in fact.",
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
      label: "Silent for",
      align: "right",
      className: "w-[120px] whitespace-nowrap",
      // Null sorts last by the table's own rule, which is wrong here: no
      // trace at all is the longest silence there is, so it is given a
      // number past any real one.
      sortValue: (r) => r.daysSince ?? 1_000_000,
      render: (r) => (
        <span
          className="text-xs tnum text-muted whitespace-nowrap"
          title={r.lastSeenAt ?? "no record of anything"}
        >
          {r.daysSince === null
            ? "always"
            : r.daysSince >= 365
              ? `${Math.floor(r.daysSince / 365)}y ${Math.floor((r.daysSince % 365) / 30)}m`
              : `${Math.floor(r.daysSince / 30)}m`}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-soft bg-bg-elev px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-subtle mr-1">
            Show only
          </span>
          <Chip
            on={onlyNever}
            onClick={() => setOnlyNever((v) => !v)}
            label="No trace at all"
            title="Nothing recorded against them, ever."
          />
          <Chip
            on={onlyRoster}
            onClick={() => setOnlyRoster((v) => !v)}
            label="On a roster anyway"
            title="In a lane or in the Shepherded band: somebody is formally responsible for them and has still not seen them in a year."
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-subtle mr-1">
            Membership
          </span>
          {types.slice(0, 12).map((t) => (
            <Chip
              key={t.type}
              on={type === t.type}
              onClick={() => setType((c) => (c === t.type ? null : t.type))}
              label={`${t.type} ${t.n.toLocaleString()}`}
            />
          ))}
        </div>
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
        {(onlyNever || onlyRoster || type) && (
          <button
            type="button"
            onClick={() => {
              setOnlyNever(false);
              setOnlyRoster(false);
              setType(null);
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
        tableClassName="table-fixed"
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
    ["Name", "Membership", "Lanes", "Band", "Last trace", "Last seen", "Days silent", "PCO link"]
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

function Chip({
  on,
  onClick,
  label,
  title,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`px-2.5 py-1 rounded-full border text-[11px] cursor-pointer transition-colors ${
        on
          ? "border-accent bg-accent-soft-bg/40 text-fg font-medium"
          : "border-border-soft text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
