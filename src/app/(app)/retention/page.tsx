import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getRetentionCohorts } from "@/lib/retention-read";
import { RetentionChart } from "./retention-chart";

export default async function RetentionPage() {
  const session = await requireOrg();
  const {
    byYear,
    byMonth,
    overallJoined,
    overallRetained,
    activityMonths,
    startYear,
  } = getRetentionCohorts(session.orgId);
  const overallPct =
    overallJoined > 0 ? Math.round((overallRetained / overallJoined) * 100) : 0;
  const pendingYears = byYear.filter((c) => c.pending).length;

  return (
    <AppShell active="Retention" breadcrumb="Retention">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Retention</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Of the people whose PCO profile was created in a given period, how
            many are still active today (in a group/team, or active by recent
            activity). Data starts in {startYear} — the {startYear - 1} import
            was the PCO transition and isn&apos;t treated as live.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Retained (settled)</div>
            <div className="tnum text-2xl font-semibold">{overallPct}%</div>
            <div className="text-xs text-muted mt-1">
              {overallRetained.toLocaleString()} of{" "}
              {overallJoined.toLocaleString()} from settled years
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Ongoing cohorts</div>
            <div className="tnum text-2xl font-semibold">{pendingYears}</div>
            <div className="text-xs text-muted mt-1">
              still inside the {activityMonths}-mo activity window
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Years tracked</div>
            <div className="tnum text-2xl font-semibold">{byYear.length}</div>
            <div className="text-xs text-muted mt-1">since {startYear}</div>
          </Card>
        </div>

        <Card className="p-5">
          {byYear.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              No profiles with a created date since {startYear} yet — run a PCO
              sync.
            </div>
          ) : (
            <RetentionChart byYear={byYear} byMonth={byMonth} />
          )}
        </Card>

        <p className="text-xs text-subtle max-w-2xl leading-relaxed">
          &ldquo;Ongoing&rdquo; cohorts are too recent to score: within the{" "}
          {activityMonths}-month activity window everyone still counts as
          active just by having joined recently, so a real retention rate
          isn&apos;t meaningful until the window has passed. &ldquo;Joined&rdquo;
          uses the PCO profile creation date as a proxy for when someone
          entered the system — a truer cohort (first attendance / first form)
          is a future enhancement.
        </p>
      </div>
    </AppShell>
  );
}
