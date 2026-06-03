"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import type {
  GroupRosterUniqueTotals,
  SyncedGroupRow,
} from "@/lib/community-lane";
import { GroupsTable } from "./groups-table";

interface Totals {
  totalGroups: number;
  activeGroups: number;
  totalMembers: number;
  totalMembersKids: number;
  totalLeaders: number;
  joinedRecently: number;
  leftRecently: number;
  growing: number;
  steady: number;
  shrinking: number;
  paused: number;
}

function computeTotals(groups: SyncedGroupRow[]): Totals {
  const t: Totals = {
    totalGroups: groups.length,
    activeGroups: 0,
    totalMembers: 0,
    totalMembersKids: 0,
    totalLeaders: 0,
    joinedRecently: 0,
    leftRecently: 0,
    growing: 0,
    steady: 0,
    shrinking: 0,
    paused: 0,
  };
  for (const g of groups) {
    t.joinedRecently += g.joinedRecently;
    t.leftRecently += g.leftRecently;
    if (g.archivedAt) continue;
    t.activeGroups += 1;
    t.totalMembers += g.members;
    t.totalMembersKids += g.membersKids;
    t.totalLeaders += g.leaders;
    t[g.state] += 1;
  }
  return t;
}

const ALL = "__all__";

export function GroupsExplorer({
  groups,
  activityMonths,
  unique,
}: {
  groups: SyncedGroupRow[];
  activityMonths: number;
  unique: GroupRosterUniqueTotals;
}) {
  const [typeFilter, setTypeFilter] = useState<string>(ALL);

  // Distinct group types in alphabetical order; null types fall under "(no type)".
  const groupTypes = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) set.add(g.groupTypeName ?? "");
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [groups]);

  const filtered = useMemo(() => {
    if (typeFilter === ALL) return groups;
    return groups.filter((g) => (g.groupTypeName ?? "") === typeFilter);
  }, [groups, typeFilter]);

  const totals = useMemo(() => computeTotals(filtered), [filtered]);

  // Unique-people headcount for the current scope (overall, or the
  // selected group type) — dedups anyone in multiple groups.
  const uniq =
    typeFilter === ALL
      ? unique.all
      : (unique.byType[typeFilter] ?? { people: 0, kids: 0, leaders: 0 });

  const ratio = uniq.leaders > 0 ? uniq.people / uniq.leaders : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <p className="text-muted text-sm">
          {totals.totalGroups === 0
            ? "No groups match this filter."
            : `${totals.activeGroups.toLocaleString()} active · ${totals.totalGroups - totals.activeGroups} archived · activity window ${activityMonths}mo`}
        </p>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted">Group type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-bg-elev border border-border-soft rounded px-2 py-1 text-fg text-xs cursor-pointer"
          >
            <option value={ALL}>All ({groups.length})</option>
            {groupTypes.map((t) => {
              const label = t === "" ? "(no type)" : t;
              const count = groups.filter(
                (g) => (g.groupTypeName ?? "") === t,
              ).length;
              return (
                <option key={t} value={t}>
                  {label} ({count})
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted mb-1.5">Active members</div>
          <div className="flex items-baseline gap-2">
            <div className="tnum text-2xl font-semibold">
              {(uniq.people - uniq.kids).toLocaleString()}
            </div>
            {uniq.kids > 0 && (
              <div className="tnum text-xs text-muted">
                +{uniq.kids.toLocaleString()} kids
              </div>
            )}
          </div>
          <div className="text-xs text-muted mt-1">unique adults in groups</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted mb-1.5">Leaders</div>
          <div className="tnum text-2xl font-semibold text-accent">
            {uniq.leaders}
          </div>
          <div className="text-xs text-muted mt-1">unique leaders</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted mb-1.5">Leader : member ratio</div>
          <div className="tnum text-2xl font-semibold">
            {ratio == null ? (
              <span className="text-subtle">—</span>
            ) : (
              <>
                1<span className="text-muted text-sm mx-1">:</span>
                {ratio.toFixed(1)}
              </>
            )}
          </div>
          <div className="text-xs text-muted mt-1">
            members per leader
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted mb-1.5">
            Joined / Left ({activityMonths}mo)
          </div>
          <div className="tnum text-2xl font-semibold">
            <span className="text-good-soft-fg">+{totals.joinedRecently}</span>
            <span className="text-muted mx-1.5">/</span>
            <span className="text-warn-soft-fg">−{totals.leftRecently}</span>
          </div>
          <div className="text-xs text-muted mt-1">includes lapsed members</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted mb-1.5">Group health</div>
          <div className="tnum text-2xl font-semibold">
            <span className="text-good-soft-fg">{totals.growing}</span>
            <span className="text-muted text-sm mx-1.5">·</span>
            <span>{totals.steady}</span>
            <span className="text-muted text-sm mx-1.5">·</span>
            <span className="text-warn-soft-fg">
              {totals.shrinking + totals.paused}
            </span>
          </div>
          <div className="text-xs text-muted mt-1">
            grow · steady · shrink/paused
          </div>
        </Card>
      </div>

      <div className="rounded-xl border border-border-soft bg-bg-elev overflow-hidden">
        <div className="px-5 py-3 border-b border-border-soft flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {typeFilter === ALL
              ? "All groups"
              : typeFilter === ""
                ? "(no type)"
                : typeFilter}
          </h2>
          <span className="text-xs text-muted">
            {uniq.people.toLocaleString()} unique people ·{" "}
            {totals.totalMembers.toLocaleString()} memberships
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted">
            No groups match this filter.
          </div>
        ) : (
          <GroupsTable groups={filtered} activityMonths={activityMonths} />
        )}
      </div>
    </div>
  );
}
