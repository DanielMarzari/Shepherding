import { AppShell } from "@/components/AppShell";
import { AttendanceTrendCard } from "@/components/AttendanceTrendCard";
import { DemographicCharts } from "@/components/DemographicCharts";
import { requireOrg } from "@/lib/auth";
import { listGroups } from "@/lib/community-lane";
import { getSyncSettings } from "@/lib/pco";
import { GroupsExplorer } from "./groups-explorer";

export default async function GroupsPage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const groups = listGroups(
    session.orgId,
    settings.activityTrackingMonths,
    settings.lapsedWeeks,
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
          <DemographicCharts
            orgId={session.orgId}
            scope="groups"
            title="Demographics — people currently in groups"
          />
        )}
        {groups.length > 0 && (
          <AttendanceTrendCard orgId={session.orgId} scope="groups" />
        )}
      </div>
    </AppShell>
  );
}
