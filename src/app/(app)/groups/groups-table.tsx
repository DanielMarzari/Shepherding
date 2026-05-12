"use client";

import { useMemo, useState } from "react";
import { Pill } from "@/components/ui";
import type { SyncedGroupRow } from "@/lib/community-lane";

const STATE_TONE = {
  growing: "good",
  steady: "muted",
  shrinking: "warn",
  paused: "warn",
} as const;

type SortKey =
  | "name"
  | "groupTypeName"
  | "state"
  | "members"
  | "leaders"
  | "attendanceTakenPct"
  | "attendancePct"
  | "joinedRecently"
  | "leftRecently"
  | "recentEvents";

type SortDir = "asc" | "desc";

const STATE_ORDER: Record<SyncedGroupRow["state"], number> = {
  growing: 0,
  steady: 1,
  shrinking: 2,
  paused: 3,
};

export function GroupsTable({
  groups,
  activityMonths,
}: {
  groups: SyncedGroupRow[];
  activityMonths: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("members");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns default to descending (biggest first); text to asc.
      setSortDir(
        key === "name" || key === "groupTypeName" || key === "state"
          ? "asc"
          : "desc",
      );
    }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...groups];
    arr.sort((a, b) => {
      // Archived rows always go last regardless of sort direction.
      if (!!a.archivedAt !== !!b.archivedAt) {
        return a.archivedAt ? 1 : -1;
      }
      const av = pickSortVal(a, sortKey);
      const bv = pickSortVal(b, sortKey);
      // Nulls sort last regardless of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [groups, sortKey, sortDir]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm table-fixed min-w-[1200px]">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[11%]" />
          <col className="w-[9%]" />
          <col className="w-[7%]" />
          <col className="w-[9%]" />
          <col className="w-[10%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead className="text-xs text-muted">
          <tr className="border-b border-border-soft">
            <SortHeader k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left">
              Group
            </SortHeader>
            <SortHeader k="groupTypeName" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left">
              Type
            </SortHeader>
            <SortHeader k="state" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left">
              State
            </SortHeader>
            <SortHeader k="members" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Members
            </SortHeader>
            <SortHeader k="leaders" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Leaders
            </SortHeader>
            <SortHeader k="attendanceTakenPct" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Attend taken
            </SortHeader>
            <SortHeader k="attendancePct" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Attend %
            </SortHeader>
            <SortHeader k="joinedRecently" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Joined ({activityMonths}mo)
            </SortHeader>
            <SortHeader k="leftRecently" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Left ({activityMonths}mo)
            </SortHeader>
            <SortHeader k="recentEvents" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Events ({activityMonths}mo)
            </SortHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.map((g) => {
            const leaderRatio =
              g.members > 0 ? (g.leaders / g.members) * 100 : null;
            return (
              <tr
                key={g.pcoId}
                className={`border-b border-border-softer hover:bg-bg-elev-2/60 ${
                  g.archivedAt ? "opacity-60" : ""
                }`}
              >
                <td className="px-5 py-2.5">
                  <div className="font-medium truncate">
                    {g.name ?? `(unnamed #${g.pcoId})`}
                    {g.archivedAt && (
                      <span className="ml-2 text-xs text-muted">archived</span>
                    )}
                  </div>
                  <div className="text-xs text-muted truncate">
                    {g.schedule ?? "—"}
                  </div>
                </td>
                <td className="px-5 py-2.5 text-muted truncate">
                  {g.groupTypeName ?? <span className="text-subtle">—</span>}
                </td>
                <td className="px-5 py-2.5">
                  <Pill tone={STATE_TONE[g.state]}>{g.state}</Pill>
                </td>
                <td className="px-5 py-2.5 text-right tnum">{g.members}</td>
                <td className="px-5 py-2.5 text-right tnum text-muted">
                  {g.leaders}
                  {leaderRatio != null && (
                    <span className="text-subtle ml-1">
                      ({Math.round(leaderRatio)}%)
                    </span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right tnum">
                  {g.attendanceTakenPct == null ? (
                    <span className="text-subtle">—</span>
                  ) : g.attendanceTakenPct === 0 ? (
                    <span className="text-warn-soft-fg">0%</span>
                  ) : (
                    `${Math.round(g.attendanceTakenPct)}%`
                  )}
                </td>
                <td className="px-5 py-2.5 text-right tnum">
                  {g.attendancePct == null ? (
                    <span className="text-subtle">NA</span>
                  ) : (
                    `${Math.round(g.attendancePct)}%`
                  )}
                </td>
                <td className="px-5 py-2.5 text-right tnum text-good-soft-fg">
                  {g.joinedRecently > 0 ? `+${g.joinedRecently}` : "0"}
                </td>
                <td className="px-5 py-2.5 text-right tnum text-warn-soft-fg">
                  {g.leftRecently > 0 ? `−${g.leftRecently}` : "0"}
                </td>
                <td className="px-5 py-2.5 text-right tnum text-muted">
                  {g.recentEvents}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function pickSortVal(g: SyncedGroupRow, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return (g.name ?? "").toLowerCase();
    case "groupTypeName":
      return (g.groupTypeName ?? "").toLowerCase();
    case "state":
      return STATE_ORDER[g.state];
    case "attendanceTakenPct":
      return g.attendanceTakenPct;
    case "attendancePct":
      return g.attendancePct;
    case "members":
    case "leaders":
    case "joinedRecently":
    case "leftRecently":
    case "recentEvents":
      return g[key];
  }
}

function SortHeader({
  k,
  sortKey,
  sortDir,
  onClick,
  align,
  children,
}: {
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align: "left" | "right";
  children: React.ReactNode;
}) {
  const active = k === sortKey;
  return (
    <th
      className={`font-medium px-5 py-2 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-fg cursor-pointer ${
          active ? "text-fg" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{children}</span>
        <span
          className={`text-[10px] ${active ? "text-accent" : "text-subtle"}`}
        >
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
