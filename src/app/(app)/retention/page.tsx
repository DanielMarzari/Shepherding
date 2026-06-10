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
    byYear, byMonth, decay, annualDecayPct, decayTrends, reactivations, seasonality, bestMonth, worstMonth,
    seasonalityTrends, overallJoined, overallRetained, activityMonths, startYear,
  } = getRetention(session.orgId);
  const overallPct =
    overallJoined > 0 ? Math.round((overallRetained / overallJoined) * 100) : 0;
  const pendingYears = byYear.filter((y) => y.pending).length;
  const maxReact = Math.max(1, ...reactivations.map((r) => r.count));

  return (
    <AppShell active="See more" breadcrumb="See more › Retention">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Retention</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Of the people whose PCO profile was created in a given year, how
            many are still active today (in a group/team, or active by recent
            activity). Each year breaks down into its 12 monthly cohorts. Covers
            join cohorts from {startYear} on (when the church started tracking in
            PCO); anyone who joined earlier is ignored.
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
              Of the adults who joined each year, how many are still retained — a true survival curve, so a cohort
              never grows in a later year. &ldquo;Retained as of a year&rdquo; = their most recent <em>real</em>{" "}
              activity (attendance, check-ins, serving, forms — deliberately not PCO profile edits) is still within
              the {activityMonths}-month window then. People who lapsed and came back are tracked separately in{" "}
              <span className="text-fg">Returns</span> below, not folded back in. Each band ramps up as people
              actually join through the year, then decays. Toggle{" "}
              <span className="text-fg">Total people</span> vs <span className="text-fg">% share</span>, and{" "}
              <span className="text-fg">By year</span> vs <span className="text-fg">By month</span>.
            </p>
            <RetentionDecayChart decay={decay} />
            {decayTrends.length > 0 && <Trends items={decayTrends} />}
          </Card>
        )}

        {/* ── Returns: lapsed then reactivated ───────────────────────── */}
        {reactivations.length > 0 && (
          <Card className="p-5 space-y-3">
            <h2 className="text-sm font-semibold">Returns</h2>
            <p className="text-xs text-muted max-w-3xl">
              People who went quiet for longer than the {activityMonths}-month activity window and then came back,
              by the year they returned — the flip side of the decay (kept separate so it doesn&apos;t inflate a
              cohort&apos;s survival). Based on recorded activity (group attendance, check-ins, serving).
            </p>
            <div className="space-y-1.5">
              {reactivations.map((r) => (
                <div key={r.year} className="flex items-center gap-3 text-xs">
                  <span className="w-10 text-muted tnum">{r.year}</span>
                  <div className="flex-1 h-4 rounded bg-bg-elev-2/60 overflow-hidden">
                    <div className="h-full rounded bg-accent" style={{ width: `${(r.count / maxReact) * 100}%` }} />
                  </div>
                  <span className="w-16 text-right tnum text-fg">{r.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
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
            <RetentionSeasonalityChart seasonality={seasonality} />
            {seasonalityTrends.length > 0 && <Trends items={seasonalityTrends} />}
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

function Trends({ items }: { items: Array<{ title: string; detail: string; tone: "up" | "down" | "neutral" }> }) {
  return (
    <div className="pt-1">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted mb-2">Trends</h3>
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {items.map((t, i) => (
          <li key={i} className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${t.tone === "up" ? "bg-good-soft-fg" : t.tone === "down" ? "bg-warn-soft-fg" : "bg-muted"}`} />
              <span className="text-sm font-medium">{t.title}</span>
            </div>
            <p className="text-xs text-muted mt-1 leading-relaxed">{t.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
