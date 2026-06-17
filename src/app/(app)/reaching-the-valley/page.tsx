import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { CHURCH } from "@/lib/geocode";
import { analyzeCensus, analyzeCounties, type CountyReach, type CountyFinding } from "@/lib/census-analysis";
import { MemberMap } from "../map/member-map";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function ReachingTheValleyPage() {
  const session = await requireOrg();
  const census = analyzeCensus(session.orgId);
  const counties = analyzeCounties(session.orgId);

  return (
    <AppShell active="See more" breadcrumb="See more › Reaching the Lehigh Valley">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reaching the Lehigh Valley</h1>
          <p className="text-muted text-sm mt-1 max-w-3xl">
            How much of the Lehigh Valley is churched vs. unchurched, how much of it Faith Church already
            reaches, and where the biggest unreached need is. The choropleth colors each census tract — switch
            between need, unchurched population, our reach, land price, churches, income, age, and drive time.
          </p>
          <p className="text-xs text-subtle mt-1">{census.source}</p>
        </div>

        <Card className="p-5 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat label="Lehigh Valley pop." value={Math.round(census.population).toLocaleString()} sub={`${census.totalTracts} census tracts`} />
            <Stat label="Churched" value={`${census.churchedPct.toFixed(1)}%`} sub={`~${Math.round(census.unchurched).toLocaleString()} unchurched`} />
            <Stat label="Lifetime reach" value={`${census.lifetimeReachPct.toFixed(1)}%`} sub={`${census.lifetimeInLV.toLocaleString()} who've touched us / valley residents`} />
            <Stat label="Of churched" value={`${census.shareOfChurchedPct.toFixed(1)}%`} sub={`${census.ourMembers.toLocaleString()} engaged / churched pop.`} />
            <Stat label="Of all Lehigh Valley" value={`${census.shareOfPopulationPct.toFixed(1)}%`} sub="engaged / total residents" />
          </div>
          <MemberMap
            church={CHURCH}
            points={[]}
            mode="census"
            census={{ tracts: census.tracts, needCampus: census.needCampus }}
            counties={counties.counties.filter((c) => !c.isValley)}
          />
          {census.needCampus && (
            <p className="text-[11px] text-subtle">
              A cost-aware, need-based second campus (purple) sited in the valid area would be closer than Faith
              Church for roughly {Math.round(census.needCampus.servedNeed).toLocaleString()} unchurched residents,
              in an area where land runs about {usd(census.needCampus.estCost)} (median home value, vs. a valley
              average of {usd(avgCost(census.tracts))}). Plan a campus on the{" "}
              <a href="/next-campus-planner" className="text-accent hover:underline">Next campus planner</a>.
            </p>
          )}
        </Card>

        {/* ── Reach beyond the Valley: the 5 neighboring counties ────── */}
        <Card className="p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Reach by county</h2>
            <p className="text-xs text-muted mt-1 max-w-3xl">
              How far our reach extends past the Valley. The same stats as above, computed for Lehigh and
              Northampton (the Valley) plus the five neighboring counties — Berks, Bucks, Montgomery, Schuylkill,
              and Carbon. &ldquo;Lifetime reach&rdquo; is everyone we&apos;ve ever placed there vs. the county&apos;s
              residents; churched % is the 2020 US Religion Census / ASARB adherence rate.
            </p>
          </div>

          {counties.findings.length > 0 && (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
              {counties.findings.map((f, i) => (
                <Finding key={i} finding={f} />
              ))}
            </ul>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs tnum border-collapse">
              <thead>
                <tr className="text-muted">
                  <th className="text-left font-medium py-1 pr-3">County</th>
                  <th className="text-right font-medium py-1 px-2">Population</th>
                  <th className="text-right font-medium py-1 px-2">Churched</th>
                  <th className="text-right font-medium py-1 px-2 border-l border-border-soft">Lifetime reach</th>
                  <th className="text-right font-medium py-1 px-2">% of residents</th>
                  <th className="text-right font-medium py-1 pl-2">Engaged</th>
                </tr>
              </thead>
              <tbody>
                {counties.counties.map((c) => (
                  <CountyRow key={c.geoid} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function CountyRow({ c }: { c: CountyReach }) {
  return (
    <tr className="border-t border-border-soft/60">
      <td className="text-left py-1 pr-3">
        <span className="text-fg font-medium">{c.name}</span>
        {c.isValley && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">Valley</span>
        )}
      </td>
      <td className="text-right py-1 px-2 text-muted">{c.population.toLocaleString()}</td>
      <td className="text-right py-1 px-2 text-muted">{c.churchedPct.toFixed(1)}%</td>
      <td className="text-right py-1 px-2 border-l border-border-soft text-fg">{c.lifetimeCount.toLocaleString()}</td>
      <td className="text-right py-1 px-2 text-fg">{c.lifetimeReachPct.toFixed(2)}%</td>
      <td className="text-right py-1 pl-2 text-muted">{c.engagedCount.toLocaleString()}</td>
    </tr>
  );
}

function Finding({ finding }: { finding: CountyFinding }) {
  return (
    <li className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${finding.tone === "up" ? "bg-good-soft-fg" : finding.tone === "down" ? "bg-warn-soft-fg" : "bg-muted"}`} />
        <span className="text-sm font-medium">{finding.title}</span>
      </div>
      <p className="text-xs text-muted mt-1 leading-relaxed">{finding.detail}</p>
    </li>
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
