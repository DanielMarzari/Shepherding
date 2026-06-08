import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { CHURCH, FAITH_CHURCH_PROFILE, getMemberGeoPoints } from "@/lib/geocode";
import { analyzeReach } from "@/lib/map-analysis";
import { analyzeCensus, computeDrawModel, computeGrowth } from "@/lib/census-analysis";
import { getMapSettings } from "@/lib/map-settings";
import { getRoadMesh } from "@/lib/road-mesh";
import { MemberMap } from "../map/member-map";
import { CampusPlannerMap } from "../map/campus-planner-map";
import { MiniMap } from "../map/mini-map";

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

        {/* ── Current campuses ───────────────────────────────────────── */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Current campuses</h2>
          <div className="grid md:grid-cols-[280px_1fr] gap-4">
            <MiniMap lat={CHURCH.lat} lng={CHURCH.lng} label={CHURCH.name} zoom={16} height="220px" />
            <div className="space-y-3">
              <div>
                <div className="text-base font-semibold">{CHURCH.name}</div>
                <div className="text-xs text-muted">{CHURCH.address} · {FAITH_CHURCH_PROFILE.denomination}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Engaged people" value={census.ourMembers.toLocaleString()} sub="shepherded/active/present (located)" />
                <Stat label="Building" value={`${FAITH_CHURCH_PROFILE.buildingSqft.toLocaleString()} ft²`} sub={FAITH_CHURCH_PROFILE.buildingNote} />
                <Stat label="Lot size" value={FAITH_CHURCH_PROFILE.lotAcres != null ? `~${FAITH_CHURCH_PROFILE.lotAcres} ac` : "—"} sub={FAITH_CHURCH_PROFILE.lotNote ?? "see county records"} />
                <Stat label="Est. market value" value={FAITH_CHURCH_PROFILE.estMarketValue != null ? usd(FAITH_CHURCH_PROFILE.estMarketValue) : "—"} sub="tax-exempt; see records" />
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <a href={FAITH_CHURCH_PROFILE.satelliteUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Satellite view</a>
                <a href={FAITH_CHURCH_PROFILE.parcelUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Lehigh County parcel / assessment</a>
              </div>
              <p className="text-[11px] text-subtle">
                Lot size is a satellite estimate (~{FAITH_CHURCH_PROFILE.lotAcres} ac) and market value isn&rsquo;t
                public for tax-exempt church property — confirm via the county parcel link. The property search below
                filters for land ≥ this lot size, so candidate sites are comparable or larger.
              </p>
            </div>
          </div>
        </Card>

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
            targetLotAcres={FAITH_CHURCH_PROFILE.lotAcres ?? 2}
          />
        </Card>

        {/* ── Healthy church growth ──────────────────────────────────── */}
        <Card className="p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold">Healthy church growth</h2>
            <span className="text-xs text-subtle">within ~{Math.round(growth.radiusMi)} mi of Faith Church</span>
          </div>
          <p className="text-xs text-muted max-w-3xl">
            The realistic ceiling isn&rsquo;t everyone — it&rsquo;s the share who even
            identify as Christian (Pew 2023–24: ~{Math.round(growth.capRate * 100)}% of Pennsylvanians,
            and dropping). Only ~{Math.round(growth.capRate * 100)}% of the catchment is a plausible churchgoer, and
            ~{(growth.churched / growth.pop * 100).toFixed(0)}% already attend somewhere — so the truly reachable pool
            (Christians not currently in a church) is smaller than the raw &ldquo;unchurched&rdquo; count. Past it,
            our growth mostly redistributes other churches&rsquo; members rather than making the valley more Christian.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Catchment" value={Math.round(growth.pop).toLocaleString()} sub={`pop · ~${Math.round(growth.radiusMi)} mi · ${growth.churches} churches`} />
            <Stat label="People per church" value={Math.round(growth.peoplePerChurch).toLocaleString()} sub="attending ÷ churches in area" />
            <Stat label="Our ministry-load share" value={`${(growth.ourShareOfChurched * 100).toFixed(1)}%`} sub={`of attenders · ${growth.ourLoadVsAvg.toFixed(1)}× an average church`} />
            <Stat label="Christians not yet churched" value={`~${Math.round(growth.netNewHeadroom).toLocaleString()}`} sub={`the reachable pool (≤${Math.round(growth.capRate * 100)}% Christian − attending)`} />
            <Stat label="Our size here" value={Math.round(growth.ourSize).toLocaleString()} sub="engaged people in catchment" />
            <Stat label="Interference point" value={`~${Math.round(growth.interferenceCeiling).toLocaleString()}`} sub="grow past this = taking from others" />
          </div>
          <p className="text-[11px] text-subtle max-w-3xl">
            Of the catchment&rsquo;s ~{Math.round(growth.pop).toLocaleString()} residents, an estimated{" "}
            {Math.round(growth.areaChurchedCap).toLocaleString()} ({Math.round(growth.capRate * 100)}%) identify as Christian and{" "}
            ~{Math.round(growth.churched).toLocaleString()} already attend a church — leaving only about{" "}
            {Math.round(growth.netNewHeadroom).toLocaleString()} reachable people who&rsquo;d genuinely add to the valley&rsquo;s
            churched count. Faith growing toward ~{Math.round(growth.interferenceCeiling).toLocaleString()} can still be
            net-positive; beyond that, the valley is about as churched as it&rsquo;s going to get, so more Faith
            attendance increasingly means drawing from the area&rsquo;s other congregations (Faith already carries{" "}
            {growth.ourLoadVsAvg.toFixed(1)}× an average church&rsquo;s load). (Christian-identity % is Pew&rsquo;s PA figure;
            the attending rate is the 2020 Religion Census — both adjustable.)
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
