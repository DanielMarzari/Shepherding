"use client";

import { useMemo, useState } from "react";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/SortableTable";
import type { UntracedPerson } from "@/lib/oversight-gaps";

/** The people, with the roster that put them here.
 *
 *  Sorted and filterable rather than grouped by roster: the map already
 *  shows it by roster, and the question this page answers is "who",
 *  which is a different shape. Someone on two unconnected rosters
 *  appears once, with both.
 */
export function UntracedTable({ people }: { people: UntracedPerson[] }) {
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.rosters.some((r) => r.toLowerCase().includes(needle)),
    );
  }, [people, q]);

  const columns: SortableColumn<UntracedPerson>[] = [
    {
      key: "name",
      label: "Person",
      align: "left",
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <a
          href={`/people/${r.personId}`}
          className="font-medium hover:text-accent"
        >
          {r.name}
        </a>
      ),
    },
    {
      key: "classification",
      label: "Classified",
      align: "left",
      sortValue: (r) => r.classification,
      render: (r) => (
        <span className="text-xs text-muted capitalize">
          {r.classification}
        </span>
      ),
    },
    {
      key: "rosters",
      label: "On these rosters, which nobody oversees",
      align: "left",
      sortValue: (r) => r.rosters[0]?.toLowerCase() ?? "",
      render: (r) => (
        <span className="flex flex-wrap gap-1.5">
          {r.rosters.map((name) => (
            <span
              key={name}
              className="px-1.5 py-0.5 rounded border border-border-soft text-[11px] text-muted"
            >
              {name}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "count",
      label: "Rosters",
      align: "right",
      sortValue: (r) => r.rosters.length,
      render: (r) => <span className="tnum text-xs">{r.rosters.length}</span>,
    },
  ];

  if (people.length === 0) {
    return (
      <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-10 text-center text-sm text-muted">
        Every live team and group has somebody connected to it, so every
        person on one can be traced to a shepherd.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name or roster…"
          aria-label="Filter the list by name or roster"
          className="bg-bg-elev border border-border-soft rounded px-3 py-1.5 text-[13px] w-full max-w-xs"
        />
        <span className="text-xs text-subtle tnum">
          {rows.length.toLocaleString()} of {people.length.toLocaleString()}
        </span>
      </div>
      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.personId}
        initialSortKey="count"
        initialSortDir="desc"
        emptyMessage="Nobody matches that."
      />
    </div>
  );
}
