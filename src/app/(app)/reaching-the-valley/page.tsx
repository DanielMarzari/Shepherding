import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { CHURCH } from "@/lib/geocode";
import { analyzeCensus } from "@/lib/census-analysis";
import { MemberMap } from "../map/member-map";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function ReachingTheValleyPage() {
  const session = await requireOrg();
  const census = analyzeCensus(session.orgId);

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
            <Stat label="Area we reach" value={`${census.reachedPopulationPct.toFixed(0)}%`} sub={`${census.reachedTracts} of ${census.totalTracts} tracts`} />
            <Stat label="Of churched" value={`${census.shareOfChurchedPct.toFixed(1)}%`} sub={`${census.ourMembers.toLocaleString()} engaged / churched pop.`} />
            <Stat label="Of all Lehigh Valley" value={`${census.shareOfPopulationPct.toFixed(1)}%`} sub="engaged / total residents" />
          </div>
          <MemberMap
            church={CHURCH}
            points={[]}
            mode="census"
            census={{ tracts: census.tracts, needCampus: census.needCampus }}
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
