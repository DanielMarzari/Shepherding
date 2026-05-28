"use client";

import Link from "next/link";
import { Avatar, Pill } from "@/components/ui";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/SortableTable";

export interface ShepherdsRow {
  personId: string;
  fullName: string;
  initials: string;
  isLeadPastor: boolean;
  needsMapping: boolean;
  overseers: Array<{ personId: string; fullName: string; via: string }>;
  groupsLed: Array<{ id: string; name: string | null }>;
  teamsLed: Array<{ id: string; name: string | null }>;
}

export function ShepherdsTable({ rows }: { rows: ShepherdsRow[] }) {
  const columns: SortableColumn<ShepherdsRow>[] = [
    {
      key: "shepherd",
      label: "Shepherd",
      align: "left",
      sortValue: (r) => r.fullName.toLowerCase(),
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar initials={r.initials} />
          <Link
            href={`/people/${r.personId}`}
            className="font-medium hover:text-accent"
          >
            {r.fullName}
          </Link>
          {r.isLeadPastor && <Pill tone="accent">lead pastor</Pill>}
        </div>
      ),
    },
    {
      key: "overseer",
      label: "Overseen by",
      align: "left",
      // Sort by first overseer's name; lead pastor + needs-mapping
      // bubble to the bottom so the actionable rows lead.
      sortValue: (r) => {
        if (r.isLeadPastor) return null;
        if (r.needsMapping) return "zzz_needs_mapping";
        return r.overseers[0]?.fullName.toLowerCase() ?? null;
      },
      render: (r) =>
        r.isLeadPastor ? (
          <span className="text-xs text-muted">
            Top of the structure — no overseer
          </span>
        ) : r.needsMapping ? (
          <Link
            href="/shepherd-map"
            title="Set this up on the Shepherd map"
          >
            <Pill tone="warn">needs mapping</Pill>
          </Link>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {r.overseers.map((o) => (
              <Link
                key={o.personId}
                href={`/people/${o.personId}`}
                title={o.via}
                className="text-xs px-2 py-0.5 rounded-full bg-bg-elev-2 text-fg hover:text-accent"
              >
                {o.fullName}
              </Link>
            ))}
          </div>
        ),
    },
    {
      key: "groups",
      label: "Groups led",
      align: "left",
      sortValue: (r) => r.groupsLed.length,
      render: (r) =>
        r.groupsLed.length === 0 ? (
          <span className="text-subtle">—</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {r.groupsLed.map((g) => (
              <span
                key={g.id}
                className="text-xs px-2 py-0.5 rounded-full bg-bg-elev-2 text-fg"
              >
                {g.name ?? `#${g.id}`}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: "teams",
      label: "Teams led",
      align: "left",
      sortValue: (r) => r.teamsLed.length,
      render: (r) =>
        r.teamsLed.length === 0 ? (
          <span className="text-subtle">—</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {r.teamsLed.map((t) => (
              <span
                key={t.id}
                className="text-xs px-2 py-0.5 rounded-full bg-bg-elev-2 text-fg"
              >
                {t.name ?? `#${t.id}`}
              </span>
            ))}
          </div>
        ),
    },
  ];
  return (
    <SortableTable
      rows={rows}
      columns={columns}
      initialSortKey="overseer"
      initialSortDir="asc"
      rowKey={(r) => r.personId}
    />
  );
}
