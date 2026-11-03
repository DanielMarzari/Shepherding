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
export function InactiveTable({
  rows,
  months,
}: {
  rows: InactiveCandidate[];
  months: number;
}) {
  const [q, setQ] = useState("");
  const [onlyNever, setOnlyNever] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!onlyNever || r.lastSeenAt === null) &&
        (!needle || r.name.toLowerCase().includes(needle)),
    );
  }, [rows, q, onlyNever]);

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
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a name…"
          aria-label="Find a name"
          className="bg-bg-elev border border-border-soft rounded px-3 py-1.5 text-[13px] w-full max-w-xs"
        />
        <button
          type="button"
          onClick={() => setOnlyNever((v) => !v)}
          aria-pressed={onlyNever}
          className={`px-2.5 py-1 rounded-full border text-[11px] cursor-pointer ${
            onlyNever
              ? "border-accent bg-accent-soft-bg/40 text-fg font-medium"
              : "border-border-soft text-muted hover:text-fg"
          }`}
        >
          No trace at all
        </button>
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
    ["Name", "Membership", "Last trace", "Last seen", "Days silent", "PCO link"]
      .map(cell)
      .join(","),
  ];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.membershipType ?? "",
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
