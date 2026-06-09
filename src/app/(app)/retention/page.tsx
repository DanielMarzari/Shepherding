import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getRetention } from "@/lib/retention-read";
import { RetentionChart } from "./retention-chart";
import { RetentionDecayChart } from "./retention-decay-chart";
import { RetentionSeasonalityChart } from "./retention-seasonality-chart";

export default async function RetentionPage() {
  const session = await requireOrg();
  const {
    byYear, byMonth, decay, annualDecayPct, seasonality, bestMonth, worstMonth,
    overallJoined, overallRetained, activityMonths, startYear,
  } = getRetention(session.orgId);
  const overallPct =
    overallJoined > 0 ? Math.round((overallRetained / overallJoined) * 100) : 0;
  const pendingYears = byYear.filter((y) => y.pending).length;

  return (
    <AppShell active="Retention" breadcrumb="Retention">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Retention</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Of the people whose PCO profile was created in a given year, how
            many are still active today (in a group/team, or active by recent
            activity). Each year breaks down into its 12 monthly cohorts. Data
            starts in {startYear} — the {startYear - 1} import was the PCO
            transition and isn&apos;t treated as live.
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

        {/* ── Decay: how each cohort's retention fell year by year ───── */}
        {decay.length > 0 && (
          <Card className="p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold">Retention decay</h2>
              {annualDecayPct != null && (
                <span className="text-xs text-subtle">
                  ≈ {annualDecayPct}% of remaining members lost per year
                </span>
              )}
            </div>
            <p className="text-xs text-muted max-w-3xl">
              Not just where each cohort sits today — how it got there. Reconstructed from each person&apos;s
              recorded activity (group attendance, check-ins, serving), so leave-then-rejoin is captured.
              Toggle <span className="text-fg">Total people</span> (stacked — watch each year&apos;s cohort taper),{" "}
              <span className="text-fg">% share</span> (composition of the engaged base), or{" "}
              <span className="text-fg">Retention %</span> (each cohort&apos;s decay curve).
            </p>
            <RetentionDecayChart decay={decay} />
          </Card>
        )}

        {/* ── Seasonality: which months retain better / worse ────────── */}
        {bestMonth && worstMonth && bestMonth.month !== worstMonth.month && (
          <Card className="p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold">Retention by join month</h2>
              <span className="text-xs text-subtle">
                best: {bestMonth.label} ({bestMonth.pct}%) · worst: {worstMonth.label} ({worstMonth.pct}%)
              </span>
            </div>
            <p className="text-xs text-muted max-w-3xl">
              Do people who join in some months stick around more than others? Settled monthly cohorts pooled by
              calendar month — useful for spotting whether a season (back-to-school, new year, summer) brings
              stickier newcomers.
            </p>
            <RetentionSeasonalityChart
              seasonality={seasonality}
              bestMonth={bestMonth.month}
              worstMonth={worstMonth.month}
            />
          </Card>
        )}

        <p className="text-xs text-subtle max-w-2xl leading-relaxed">
          &ldquo;Ongoing&rdquo; cohorts are too recent to score: within the{" "}
          {activityMonths}-month activity window everyone still counts as
          active just by having joined recently, so a real retention rate
          isn&apos;t meaningful until the window has passed. &ldquo;Joined&rdquo;
          uses the PCO profile creation date as a proxy for when someone
          entered the system.
        </p>
      </div>
    </AppShell>
  );
}
