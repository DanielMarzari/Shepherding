import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { CHURCH, getMemberGeoPoints } from "@/lib/geocode";
import { analyzeReach } from "@/lib/map-analysis";
import { analyzeCensus } from "@/lib/census-analysis";
import { getMapSettings } from "@/lib/map-settings";
import { MemberMap } from "../map/member-map";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function NextCampusPlannerPage() {
  const session = await requireOrg();
  const points = getMemberGeoPoints(session.orgId);
  const mapSettings = getMapSettings(session.orgId);
  const reach = analyzeReach(session.orgId, mapSettings.secondCampusMaxHours);
  const census = analyzeCensus(session.orgId);

  return (
    <AppShell active="See more" breadcrumb="See more › Next campus planner">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Next campus planner</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Where Faith Church should consider a second campus — weighing where
            your people are, where the Lehigh Valley&rsquo;s unreached need is,
            and what land costs. Candidate sites are constrained to the valid
            area (Lehigh Valley + 5 miles).
          </p>
        </div>

        {/* ── Census: churched vs unchurched + areas of need ─────────── */}
        <Card className="p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold">Reaching the Lehigh Valley</h2>
            <span className="text-xs text-subtle">{census.source}</span>
          </div>
          <p className="text-xs text-muted max-w-2xl">
            How much of the Lehigh Valley is churched vs. unchurched, how much
            of it Faith Church already reaches, and where the biggest unreached
            need is. The choropleth colors each census tract — switch between
            need, unchurched population, and our reach. The purple marker is
            where a cost-aware second campus would best center the unmet need.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Lehigh Valley pop." value={Math.round(census.population).toLocaleString()} sub={`${census.totalTracts} census tracts`} />
            <Stat label="Churched" value={`${census.churchedPct.toFixed(1)}%`} sub={`~${Math.round(census.unchurched).toLocaleString()} unchurched`} />
            <Stat label="Area we reach" value={`${census.reachedPopulationPct.toFixed(0)}%`} sub={`${census.reachedTracts} of ${census.totalTracts} tracts have our people`} />
            <Stat label="Our footprint" value={`${census.shareOfChurchedPct.toFixed(1)}%`} sub={`of churched · ${census.shareOfPopulationPct.toFixed(1)}% of all residents`} />
          </div>
          <MemberMap
            church={CHURCH}
            points={[]}
            mode="census"
            census={{ tracts: census.tracts, needCampus: census.needCampus }}
          />
          {census.topNeed.length > 0 && (
            <div>
              <div className="text-xs text-muted mb-1.5">Biggest unreached need (by tract)</div>
              <div className="flex flex-wrap gap-2">
                {census.topNeed.map((t) => (
                  <div key={t.geoid} className="rounded-lg border border-border-soft bg-bg-elev-2/40 px-3 py-2 text-xs">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-muted tnum">
                      ~{Math.round(t.unchurched).toLocaleString()} unchurched · {t.ourCount} of our people · land {usd(t.cost)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {census.needCampus && (
            <p className="text-[11px] text-subtle">
              A cost-aware, need-based second campus (purple) sited in the valid
              area would be closer than Faith Church for roughly{" "}
              {Math.round(census.needCampus.servedNeed).toLocaleString()} unchurched
              residents, in an area where land runs about {usd(census.needCampus.estCost)}{" "}
              (median home value, vs. a valley average of {usd(avgCost(census.tracts))}).
            </p>
          )}
        </Card>

        {/* ── People-based second-campus siting per cohort ───────────── */}
        {reach.secondCampuses.length > 0 && (
          <Card className="p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold">Second campus for your people</h2>
              <span className="text-xs text-subtle">
                excludes homes &gt; {mapSettings.secondCampusMaxHours}h away ·{" "}
                <a href="/metrics" className="text-accent hover:underline">change in Metrics</a>
              </span>
            </div>
            <p className="text-xs text-muted max-w-2xl">
              The best spot for a second location to serve each group — switch
              cohorts with “Plan for” on the map. The{" "}
              <span className="text-fg">inactive</span> option is weighted toward
              people who live farther out (the hypothesis being distance is part
              of why they drifted). Estimated land cost is shown per site.
            </p>
            <MemberMap
              church={CHURCH}
              points={points}
              secondCampuses={reach.secondCampuses}
              mode="campus"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-border-soft">
                    <th className="text-left font-medium py-1.5 pr-4">Serves</th>
                    <th className="text-left font-medium py-1.5 pr-4">Near</th>
                    <th className="text-right font-medium py-1.5 pr-4">Closer for</th>
                    <th className="text-right font-medium py-1.5 pr-4">Avg distance</th>
                    <th className="text-right font-medium py-1.5">Est. land cost</th>
                  </tr>
                </thead>
                <tbody>
                  {reach.secondCampuses.map((sc) => (
                    <tr key={sc.cohort} className="border-b border-border-softer">
                      <td className="py-2 pr-4 capitalize">
                        {sc.cohort === "all" ? "Everyone" : sc.cohort}
                      </td>
                      <td className="py-2 pr-4 text-muted">{sc.label}</td>
                      <td className="py-2 pr-4 text-right tnum">{sc.served.toLocaleString()} homes</td>
                      <td className="py-2 pr-4 text-right tnum">
                        {sc.avgMilesBefore.toFixed(1)} → {sc.avgMilesAfter.toFixed(1)} mi
                      </td>
                      <td className="py-2 text-right tnum">{usd(sc.estCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-subtle">
              Land cost is the median home value of the area each site lands in
              (ACS, a proxy for property cost) — useful for weighing a cheaper
              nearby alternative against the people-optimal spot.
            </p>
          </Card>
        )}

        {reach.secondCampuses.length === 0 && (
          <p className="text-xs text-subtle max-w-2xl">
            Not enough geocoded people yet to suggest a campus. Geocode the
            directory and compute driving distances on the{" "}
            <a href="/map" className="text-accent hover:underline">Member map</a>.
          </p>
        )}
      </div>
    </AppShell>
  );
}

function avgCost(tracts: Array<{ cost: number }>): number {
  const vals = tracts.map((t) => t.cost).filter((c) => c > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="tnum text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-subtle mt-0.5">{sub}</div>
    </div>
  );
}
