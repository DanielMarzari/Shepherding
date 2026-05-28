"use client";

import Link from "next/link";
import { Avatar, Pill } from "@/components/ui";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/SortableTable";
import {
  TARGET_KIND_LABELS,
  type Assignment,
  type TargetKind,
} from "@/lib/assignments-types";

const KIND_TONES: Record<TargetKind, "muted" | "accent" | "warn" | "good"> = {
  group: "accent",
  group_type: "muted",
  team: "good",
  service_type: "muted",
  team_position: "good",
  person: "warn",
  membership_type: "accent",
  shepherd_team: "warn",
  reference_list: "muted",
};

export interface ShepherdRowData {
  personId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  assignments: Assignment[];
  staffDirect: number;
  volunteerLeaders: number;
  congregants: number;
  careNonShepherded: number;
  totalReach: number;
}

const TONE_CLASS = {
  good: "text-good-soft-fg",
  accent: "text-accent",
  warn: "text-warn-soft-fg",
  muted: "text-muted",
  subtle: "text-subtle",
} as const;

function num(n: number, tone: keyof typeof TONE_CLASS) {
  if (n === 0) return <span className={TONE_CLASS.subtle}>—</span>;
  return <span className={TONE_CLASS[tone]}>{n.toLocaleString()}</span>;
}

export function ShepherdTeamTable({ rows }: { rows: ShepherdRowData[] }) {
  const columns: SortableColumn<ShepherdRowData>[] = [
    {
      key: "person",
      label: "Person",
      sortValue: (r) => r.fullName.toLowerCase(),
      align: "left",
      render: (r) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <Avatar initials={r.initials} size="sm" />
          <div className="min-w-0">
            <Link
              href={`/people/${r.personId}`}
              className="font-medium truncate hover:text-accent"
            >
              {r.fullName}
            </Link>
            {r.membershipType && (
              <div className="text-xs text-muted truncate">
                {r.membershipType}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "assignments",
      label: "Assignments",
      sortValue: (r) => r.assignments.length,
      align: "left",
      render: (r) =>
        r.assignments.length === 0 ? (
          <span className="text-xs text-subtle">No assignments yet</span>
        ) : (
          <ul className="space-y-1 max-w-md">
            {r.assignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 text-xs flex-wrap"
              >
                <Pill tone={KIND_TONES[a.targetKind]}>
                  {TARGET_KIND_LABELS[a.targetKind]}
                </Pill>
                <span className="truncate">{a.targetName}</span>
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: "staff",
      label: "Staff",
      title:
        "Staff list members directly assigned to this shepherd who aren't already counted in the other three buckets.",
      align: "right",
      sortValue: (r) => r.staffDirect,
      render: (r) => num(r.staffDirect, "muted"),
    },
    {
      key: "volunteer",
      label: "Volunteer leaders",
      title:
        "Distinct leaders of groups/teams this shepherd oversees via the shepherd map.",
      align: "right",
      sortValue: (r) => r.volunteerLeaders,
      render: (r) => num(r.volunteerLeaders, "good"),
    },
    {
      key: "congregants",
      label: "Congregants",
      title:
        "Distinct non-leader members of groups/teams this shepherd directly leads in PCO.",
      align: "right",
      sortValue: (r) => r.congregants,
      render: (r) => num(r.congregants, "accent"),
    },
    {
      key: "assigned",
      label: "Assigned",
      title:
        "Care-map assignments to people not currently in any group or team.",
      align: "right",
      sortValue: (r) => r.careNonShepherded,
      render: (r) => num(r.careNonShepherded, "warn"),
    },
    {
      key: "total",
      label: "Total",
      align: "right",
      sortValue: (r) => r.totalReach,
      render: (r) => (
        <span className="font-medium">{r.totalReach.toLocaleString()}</span>
      ),
    },
  ];

  return (
    <SortableTable
      rows={rows}
      columns={columns}
      initialSortKey="total"
      initialSortDir="desc"
      rowKey={(r) => r.personId}
    />
  );
}
