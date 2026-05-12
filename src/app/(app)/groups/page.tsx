import { AppShell } from "@/components/AppShell";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getGroupTotals, listGroups } from "@/lib/community-lane";
import { getSyncSettings } from "@/lib/pco";
import { GroupsTable } from "./groups-table";

export default async function GroupsPage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const groups = listGroups(
    session.orgId,
    settings.activityTrackingMonths,
    settings.lapsedWeeks,
  );
  const totals = getGroupTotals(
    session.orgId,
    settings.activityTrackingMonths,
    settings.lapsedWeeks,
  );

  return (
    <AppShell active="Groups" breadcrumb="Groups">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
            <p className="text-muted text-sm mt-1">
              {totals.totalGroups === 0
                ? "No groups synced yet — turn on the Groups entity in Sync settings and run a sync."
                : `${totals.activeGroups.toLocaleString()} active · ${totals.totalGroups - totals.activeGroups} archived · activity window ${settings.activityTrackingMonths}mo`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Active members</div>
            <div className="tnum text-2xl font-semibold">{totals.totalMembers}</div>
            <div className="text-xs text-muted mt-1">across all active groups</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Leaders</div>
            <div className="tnum text-2xl font-semibold text-accent">
              {totals.totalLeaders}
              {totals.totalMembers > 0 && (
                <span className="text-muted text-sm font-normal ml-2">
                  · 1 : {(totals.totalMembers / Math.max(1, totals.totalLeaders)).toFixed(1)}
                </span>
              )}
            </div>
            <div className="text-xs text-muted mt-1">leader-to-member ratio</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Joined / Left ({settings.activityTrackingMonths}mo)</div>
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
              <span className="text-warn-soft-fg">{totals.shrinking + totals.paused}</span>
            </div>
            <div className="text-xs text-muted mt-1">grow · steady · shrink/paused</div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="All groups"
            right={
              <span className="text-xs text-muted">
                {totals.totalMembers.toLocaleString()} active memberships
              </span>
            }
          />
          {groups.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted">
              No groups synced yet.
            </div>
          ) : (
            <GroupsTable
              groups={groups}
              activityMonths={settings.activityTrackingMonths}
            />
          )}
        </Card>
      </div>
    </AppShell>
  );
}
