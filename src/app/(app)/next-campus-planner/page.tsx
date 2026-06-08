import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { CHURCH, getMemberGeoPoints } from "@/lib/geocode";
import { analyzeReach } from "@/lib/map-analysis";
import { analyzeCensus, computeDrawModel, computeGrowth } from "@/lib/census-analysis";
import { getMapSettings } from "@/lib/map-settings";
import { getRoadMesh } from "@/lib/road-mesh";
import { MemberMap } from "../map/member-map";
import { CampusPlannerMap } from "../map/campus-planner-map";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function NextCampusPlannerPage() {
  const session = await requireOrg();
  const points = getMemberGeoPoints(session.orgId);
  const mapSettings = getMapSettings(session.orgId);
  const reach = analyzeReach(session.orgId, mapSettings.secondCampusMaxHours);
  const census = analyzeCensus(session.orgId);
  const mesh = getRoadMesh(session.orgId);
  const drawModel = computeDrawModel(census.tracts, census.ourMembers, reach.avgMiles);
  const growth = computeGrowth(census.tracts, reach.avgMiles);
  const allCohort = reach.secondCampuses.find((s) => s.cohort === "all");
  const initialCampus = census.needCampus
    ? { lat: census.needCampus.lat, lng: census.needCampus.lng }
    : allCohort
      ? { lat: allCohort.lat, lng: allCohort.lng }
      : { lat: CHURCH.lat, lng: CHURCH.lng };
  // Auto-suggested candidate sites = need-based + per-cohort people-based.
  const suggestions = [
    ...(census.needCampus ? [{ label: "unreached (need-based)", lat: census.needCampus.lat, lng: census.needCampus.lng }] : []),
    ...reach.secondCampuses.map((sc) => ({
      label: sc.cohort === "all" ? "everyone" : sc.cohort,
      lat: sc.lat,
      lng: sc.lng,
    })),
  ];

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

        {/* ── Interactive: drag-to-test a campus, stack any layers ───── */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Test a location</h2>
          <p className="text-xs text-muted max-w-2xl">
            Drag the blue dot anywhere in the valley to test a campus site. The
            table updates live — homes it&rsquo;s closer to than Faith Church,
            the average distance to whichever campus is nearest, estimated land
            cost, unreached people it would serve, and existing churches nearby.
            Stack any layers (our people, roads driven, and tract shading by
            need / unchurched / reach / land price / churches) to eyeball the
            ideal spot.
          </p>
          <CampusPlannerMap
            church={CHURCH}
            points={points}
            tracts={census.tracts}
            mesh={{ roads: mesh.roads }}
            initial={initialCampus}
            model={drawModel}
            suggestions={suggestions}
          />
        </Card>

        {/* ── Healthy church growth ──────────────────────────────────── */}
        <Card className="p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold">Healthy church growth</h2>
            <span className="text-xs text-subtle">within ~{Math.round(growth.radiusMi)} mi of Faith Church</span>
          </div>
          <p className="text-xs text-muted max-w-2xl">
            How much Faith Church can grow by reaching the unchurched (net
            benefit to the valley) before further growth has to come from the
            area&rsquo;s other churches — transfer growth that doesn&rsquo;t
            raise the valley&rsquo;s churched share.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat label="Catchment population" value={Math.round(growth.pop).toLocaleString()} sub={`~${Math.round(growth.radiusMi)} mi around FC`} />
            <Stat label="Unchurched in reach" value={Math.round(growth.unchurched).toLocaleString()} sub="the net-positive growth pool" />
            <Stat label="Our size here" value={Math.round(growth.ourSize).toLocaleString()} sub="engaged people in catchment" />
            <Stat label="Healthy growth ceiling" value={`~${Math.round(growth.healthyMax).toLocaleString()}`} sub="our size + all local unchurched" />
            <Stat label="Headroom" value={`~${Math.max(0, Math.round(growth.healthyMax - growth.ourSize)).toLocaleString()}`} sub={`${growth.healthyMax > 0 ? Math.round((growth.ourSize / growth.healthyMax) * 100) : 0}% of ceiling reached`} />
          </div>
          <p className="text-[11px] text-subtle max-w-3xl">
            Past ~{Math.round(growth.healthyMax).toLocaleString()} people, you&rsquo;d have effectively
            absorbed every unchurched person within reach, so new attenders would
            increasingly transfer from other congregations. Of the people you don&rsquo;t
            yet reach, {Math.round(growth.transferShareNow * 100)}% already attend another church — the higher
            that share, the sooner growth starts drawing from them rather than the unchurched.
            (Assumes the 2020 county churched rate; reaching 100% of the unchurched is a ceiling, not a forecast.)
          </p>
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
