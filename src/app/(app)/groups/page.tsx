import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getGroupTotals, listGroups } from "@/lib/community-lane";
import { getSyncSettings } from "@/lib/pco";

const STATE_TONE = {
  growing: "good",
  steady: "muted",
  shrinking: "warn",
  paused: "warn",
} as const;

export default async function GroupsPage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const groups = listGroups(session.orgId, settings.activityTrackingMonths);
  const totals = getGroupTotals(session.orgId, settings.activityTrackingMonths);

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
            <div className="text-xs text-muted mb-1.5">Growing</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">
              {totals.growing}
            </div>
            <div className="text-xs text-muted mt-1">net +2 or more</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Steady</div>
            <div className="tnum text-2xl font-semibold">{totals.steady}</div>
            <div className="text-xs text-muted mt-1">net within ±1</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Shrinking</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">
              {totals.shrinking}
            </div>
            <div className="text-xs text-muted mt-1">net −2 or more</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Paused / archived</div>
            <div className="tnum text-2xl font-semibold">{totals.paused}</div>
            <div className="text-xs text-muted mt-1">no recent events</div>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed min-w-[860px]">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead className="text-xs text-muted">
                  <tr className="border-b border-border-soft">
                    <th className="text-left font-medium px-5 py-2">Group</th>
                    <th className="text-left font-medium px-5 py-2">Type</th>
                    <th className="text-left font-medium px-5 py-2">State</th>
                    <th className="text-right font-medium px-5 py-2">Members</th>
                    <th className="text-right font-medium px-5 py-2">
                      Joined ({settings.activityTrackingMonths}mo)
                    </th>
                    <th className="text-right font-medium px-5 py-2">
                      Events ({settings.activityTrackingMonths}mo)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
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
                      <td className="px-5 py-2.5 text-right tnum text-good-soft-fg">
                        {g.joinedRecently > 0 ? `+${g.joinedRecently}` : "0"}
                      </td>
                      <td className="px-5 py-2.5 text-right tnum text-muted">
                        {g.recentEvents}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
