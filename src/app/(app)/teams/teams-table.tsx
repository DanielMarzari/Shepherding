"use client";

import { useMemo, useState } from "react";
import { Pill } from "@/components/ui";
import type { SyncedTeamRow } from "@/lib/serve-lane";

const STATE_TONE = {
  growing: "good",
  steady: "muted",
  shrinking: "warn",
  paused: "warn",
} as const;

type SortKey =
  | "name"
  | "serviceTypeName"
  | "state"
  | "members"
  | "leaders"
  | "servedRecently"
  | "lapsed";

type SortDir = "asc" | "desc";

const STATE_ORDER: Record<SyncedTeamRow["state"], number> = {
  growing: 0,
  steady: 1,
  shrinking: 2,
  paused: 3,
};

export function TeamsTable({
  teams,
  activityMonths,
  lapsedMonths,
}: {
  teams: SyncedTeamRow[];
  activityMonths: number;
  lapsedMonths: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("members");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "name" || key === "serviceTypeName" || key === "state"
          ? "asc"
          : "desc",
      );
    }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...teams];
    arr.sort((a, b) => {
      if (!!a.archivedAt !== !!b.archivedAt) {
        return a.archivedAt ? 1 : -1;
      }
      const av = pickSortVal(a, sortKey);
      const bv = pickSortVal(b, sortKey);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [teams, sortKey, sortDir]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm table-fixed min-w-[1000px]">
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[16%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead className="text-xs text-muted">
          <tr className="border-b border-border-soft">
            <SortHeader k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left">
              Team
            </SortHeader>
            <SortHeader k="serviceTypeName" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left">
              Service type
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
            <SortHeader k="servedRecently" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Served ({activityMonths}mo)
            </SortHeader>
            <SortHeader k="lapsed" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">
              Lapsed ({lapsedMonths}mo)
            </SortHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr
              key={t.pcoId}
              className={`border-b border-border-softer hover:bg-bg-elev-2/60 ${
                t.archivedAt ? "opacity-60" : ""
              }`}
            >
              <td className="px-5 py-2.5">
                <div className="font-medium truncate">
                  {t.name ?? `(unnamed #${t.pcoId})`}
                  {t.archivedAt && (
                    <span className="ml-2 text-xs text-muted">archived</span>
                  )}
                </div>
              </td>
              <td className="px-5 py-2.5 text-muted truncate">
                {t.serviceTypeName ?? <span className="text-subtle">—</span>}
              </td>
              <td className="px-5 py-2.5">
                <Pill tone={STATE_TONE[t.state]}>{t.state}</Pill>
              </td>
              <td className="px-5 py-2.5 text-right tnum">{t.members}</td>
              <td className="px-5 py-2.5 text-right tnum text-muted">
                {t.leaders}
              </td>
              <td className="px-5 py-2.5 text-right tnum text-good-soft-fg">
                {t.servedRecently > 0 ? t.servedRecently : "0"}
              </td>
              <td className="px-5 py-2.5 text-right tnum text-warn-soft-fg">
                {t.lapsed > 0 ? t.lapsed : "0"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function pickSortVal(t: SyncedTeamRow, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return (t.name ?? "").toLowerCase();
    case "serviceTypeName":
      return (t.serviceTypeName ?? "").toLowerCase();
    case "state":
      return STATE_ORDER[t.state];
    case "members":
    case "leaders":
    case "servedRecently":
    case "lapsed":
      return t[key];
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
