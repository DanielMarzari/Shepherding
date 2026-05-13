import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import { getTeamTotals, listTeams } from "@/lib/serve-lane";
import { TeamsTable } from "./teams-table";

export default async function TeamsPage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const teams = listTeams(
    session.orgId,
    settings.activityTrackingMonths,
    settings.lapsedFromTeamMonths,
  );
  const totals = getTeamTotals(teams);
  const ratio =
    totals.totalLeaders > 0
      ? totals.totalMembers / totals.totalLeaders
      : null;

  return (
    <AppShell active="Teams" breadcrumb="Teams">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
            <p className="text-muted text-sm mt-1">
              {totals.totalTeams === 0
                ? "No teams synced yet — turn on Service teams under Sync settings and run a sync."
                : `${totals.activeTeams.toLocaleString()} active teams · lapsed-from-team threshold ${settings.lapsedFromTeamMonths}mo · archived teams hidden`}
            </p>
          </div>
        </div>

        {teams.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted mb-1.5">Roster size</div>
              <div className="tnum text-2xl font-semibold">
                {totals.totalMembers}
              </div>
              <div className="text-xs text-muted mt-1">distinct people on teams</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted mb-1.5">Leaders</div>
              <div className="tnum text-2xl font-semibold text-accent">
                {totals.totalLeaders}
              </div>
              <div className="text-xs text-muted mt-1">flagged as team leader</div>
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
              <div className="text-xs text-muted mt-1">members per leader</div>
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
                lapsed = no plan in {settings.lapsedFromTeamMonths}mo
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
        )}

        <div className="rounded-xl border border-border-soft bg-bg-elev overflow-hidden">
          <div className="px-5 py-3 border-b border-border-soft flex items-center justify-between">
            <h2 className="text-sm font-semibold">All teams</h2>
            <span className="text-xs text-muted">
              {totals.totalMembers.toLocaleString()} distinct people on roster
            </span>
          </div>
          {teams.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted">
              No teams synced yet.
            </div>
          ) : (
            <TeamsTable
              teams={teams}
              activityMonths={settings.activityTrackingMonths}
              lapsedMonths={settings.lapsedFromTeamMonths}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
