import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import { getTeamTotals, listTeams } from "@/lib/serve-lane";

const STATE_TONE = {
  growing: "good",
  steady: "muted",
  shrinking: "warn",
  paused: "warn",
} as const;

export default async function TeamsPage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const teams = listTeams(
    session.orgId,
    settings.activityTrackingMonths,
    settings.lapsedFromTeamWeeks,
  );
  const totals = getTeamTotals(
    session.orgId,
    settings.activityTrackingMonths,
    settings.lapsedFromTeamWeeks,
  );

  return (
    <AppShell active="Teams" breadcrumb="Teams">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
            <p className="text-muted text-sm mt-1">
              {totals.totalTeams === 0
                ? "No teams synced yet — turn on Service teams under Sync settings and run a sync."
                : `${totals.activeTeams.toLocaleString()} active · ${totals.totalTeams - totals.activeTeams} archived · lapsed-from-team threshold ${settings.lapsedFromTeamWeeks}wk`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Roster size</div>
            <div className="tnum text-2xl font-semibold">{totals.totalMembers}</div>
            <div className="text-xs text-muted mt-1">across all active teams</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Leaders</div>
            <div className="tnum text-2xl font-semibold text-accent">
              {totals.totalLeaders}
              {totals.totalMembers > 0 && totals.totalLeaders > 0 && (
                <span className="text-muted text-sm font-normal ml-2">
                  · 1 : {(totals.totalMembers / totals.totalLeaders).toFixed(1)}
                </span>
              )}
            </div>
            <div className="text-xs text-muted mt-1">leader-to-member ratio</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">
              Served / Lapsed ({settings.activityTrackingMonths}mo)
            </div>
            <div className="tnum text-2xl font-semibold">
              <span className="text-good-soft-fg">{totals.servedRecently}</span>
              <span className="text-muted mx-1.5">/</span>
              <span className="text-warn-soft-fg">{totals.totalLapsed}</span>
            </div>
            <div className="text-xs text-muted mt-1">
              lapsed = no plan in {settings.lapsedFromTeamWeeks}wk
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Team health</div>
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

        <Card>
          <CardHeader
            title="All teams"
            right={
              <span className="text-xs text-muted">
                {totals.totalMembers.toLocaleString()} active roster spots
              </span>
            }
          />
          {teams.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted">
              No teams synced yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed min-w-[1000px]">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[16%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead className="text-xs text-muted">
                  <tr className="border-b border-border-soft">
                    <th className="text-left font-medium px-5 py-2">Team</th>
                    <th className="text-left font-medium px-5 py-2">Service type</th>
                    <th className="text-left font-medium px-5 py-2">State</th>
                    <th className="text-right font-medium px-5 py-2">Members</th>
                    <th className="text-right font-medium px-5 py-2">Leaders</th>
                    <th className="text-right font-medium px-5 py-2">
                      Served ({settings.activityTrackingMonths}mo)
                    </th>
                    <th className="text-right font-medium px-5 py-2">
                      Lapsed ({settings.lapsedFromTeamWeeks}wk)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => {
                    const leaderRatio =
                      t.members > 0 ? (t.leaders / t.members) * 100 : null;
                    return (
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
                              <span className="ml-2 text-xs text-muted">
                                archived
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-muted truncate">
                          {t.serviceTypeName ?? (
                            <span className="text-subtle">—</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          <Pill tone={STATE_TONE[t.state]}>{t.state}</Pill>
                        </td>
                        <td className="px-5 py-2.5 text-right tnum">{t.members}</td>
                        <td className="px-5 py-2.5 text-right tnum text-muted">
                          {t.leaders}
                          {leaderRatio != null && (
                            <span className="text-subtle ml-1">
                              ({Math.round(leaderRatio)}%)
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-right tnum text-good-soft-fg">
                          {t.servedRecently > 0 ? t.servedRecently : "0"}
                        </td>
                        <td className="px-5 py-2.5 text-right tnum text-warn-soft-fg">
                          {t.lapsed > 0 ? t.lapsed : "0"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
