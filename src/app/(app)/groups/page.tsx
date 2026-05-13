import { AppShell } from "@/components/AppShell";
import { AttendanceTrendCard } from "@/components/AttendanceTrendCard";
import { ChartScopeFilter } from "@/components/ChartScopeFilter";
import { DemographicCharts } from "@/components/DemographicCharts";
import { requireOrg } from "@/lib/auth";
import { listGroups } from "@/lib/community-lane";
import { getGroupTypeStats, getSyncSettings } from "@/lib/pco";
import type { DemographicScope } from "@/lib/demographics";
import { GroupsExplorer } from "./groups-explorer";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ chart?: string }>;
}) {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const params = await searchParams;
  const groups = listGroups(
    session.orgId,
    settings.activityTrackingMonths,
    settings.lapsedWeeks,
  );

  const { scope, scopeLabel, options } = resolveScope(
    params.chart,
    groups,
    getGroupTypeStats(session.orgId),
  );

  return (
    <AppShell active="Groups" breadcrumb="Groups">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
          {groups.length === 0 && (
            <p className="text-muted text-sm mt-1">
              No groups synced yet — turn on the Groups entity in Sync settings and
              run a sync.
            </p>
          )}
        </div>
        {groups.length > 0 && (
          <GroupsExplorer
            groups={groups}
            activityMonths={settings.activityTrackingMonths}
          />
        )}
        {groups.length > 0 && (
          <div className="flex items-end justify-between gap-3 flex-wrap border-t border-border-soft pt-5">
            <p className="text-xs text-muted">
              Charts below are scoped to <span className="text-fg">{scopeLabel}</span>
            </p>
            <ChartScopeFilter current={params.chart ?? "all"} groups={options} />
          </div>
        )}
        {groups.length > 0 && (
          <DemographicCharts
            orgId={session.orgId}
            scope={scope}
            title={`Demographics — ${scopeLabel}`}
          />
        )}
        {groups.length > 0 && (
          <AttendanceTrendCard
            orgId={session.orgId}
            trendScope="groups"
            filterScope={scope}
          />
        )}
      </div>
    </AppShell>
  );
}

function resolveScope(
  raw: string | undefined,
  groups: Array<{ pcoId: string; name: string | null; groupTypeName: string | null }>,
  types: Array<{ groupTypeId: string | null; name: string | null }>,
): {
  scope: DemographicScope;
  scopeLabel: string;
  options: Array<{ label: string; options: Array<{ value: string; label: string }> }>;
} {
  let scope: DemographicScope = { kind: "groups" };
  let scopeLabel = "all groups";

  if (raw && raw.startsWith("group:")) {
    const id = raw.slice(6);
    const g = groups.find((x) => x.pcoId === id);
    if (g) {
      scope = { kind: "group", id };
      scopeLabel = g.name ?? `Group #${id}`;
    }
  } else if (raw && raw.startsWith("groupType:")) {
    const id = raw.slice(10);
    const t = types.find((x) => (x.groupTypeId ?? "") === id);
    if (t) {
      scope = { kind: "groupType", id };
      scopeLabel = t.name ?? "(no type)";
    }
  }

  const options = [
    {
      label: "Cohort",
      options: [{ value: "all", label: "All groups (active)" }],
    },
    {
      label: "By group type",
      options: types.map((t) => ({
        value: `groupType:${t.groupTypeId ?? ""}`,
        label: t.name ?? "(no type)",
      })),
    },
    {
      label: "Single group",
      options: groups.map((g) => ({
        value: `group:${g.pcoId}`,
        label: g.name ?? `Group #${g.pcoId}`,
      })),
    },
  ];

  return { scope, scopeLabel, options };
}
