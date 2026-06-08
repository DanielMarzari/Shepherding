import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { CHURCH, FAITH_CHURCH_PROFILE, getMemberGeoPoints } from "@/lib/geocode";
import { analyzeReach } from "@/lib/map-analysis";
import { analyzeCensus, computeDrawModel, computeGrowth } from "@/lib/census-analysis";
import { LV_CENSUS_META } from "@/lib/lv-census";
import { getMapSettings } from "@/lib/map-settings";
import { getRoadMesh } from "@/lib/road-mesh";
import { getWeeklyAttendance } from "@/lib/attendance-read";
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
  const growth = computeGrowth(census.tracts, reach.estDriveMin);
  const attendance = getWeeklyAttendance(session.orgId);
  // Church density vs national (comprehensive 2020 Religion Census counts).
  const churchesPer10k = census.population > 0 ? (LV_CENSUS_META.congregations / census.population) * 10000 : 0;
  const nat = LV_CENSUS_META.nationalChurchesPer10k;
  // Growth vs the valley (our YoY attendance change vs LV population growth).
  const ourGrowthPct = attendance.inPersonTrend12moDelta; // % vs prior 12 mo (may be null)
  const popGrowthPct = LV_CENSUS_META.lvPopGrowthPctYoY;
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
            <span className="text-xs text-subtle">within ~{Math.round(growth.driveMinThreshold)} min drive of Faith Church</span>
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
            <Stat label="Catchment" value={Math.round(growth.pop).toLocaleString()} sub={`pop · ~${Math.round(growth.driveMinThreshold)} min drive · ${growth.churches} churches`} />
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

        {/* ── Church density vs national ─────────────────────────────── */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Church density</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Churches per 10k" value={churchesPer10k.toFixed(1)} sub={`${LV_CENSUS_META.congregations} congregations (all faiths)`} />
            <Stat label="National average" value={nat.toFixed(1)} sub="per 10k residents (2020)" />
            <Stat
              label={churchesPer10k < nat ? "Under-served" : "Over-served"}
              value={`${Math.abs(Math.round(((churchesPer10k - nat) / nat) * 100))}%`}
              sub={churchesPer10k < nat ? "fewer churches per capita than the US" : "more churches per capita than the US"}
            />
            <Stat label="People per church" value={Math.round(census.population / LV_CENSUS_META.congregations).toLocaleString()} sub="residents per congregation" />
          </div>
          <p className="text-[11px] text-subtle max-w-3xl">
            The Lehigh Valley has about {churchesPer10k.toFixed(1)} congregations per 10,000 residents vs. roughly{" "}
            {nat.toFixed(1)} nationally — so it&rsquo;s {churchesPer10k < nat ? "under-served" : "over-served"} relative
            to the US average, leaving {churchesPer10k < nat ? "room for more churches" : "limited room"} per capita.
            (Comprehensive 2020 U.S. Religion Census congregation counts, all faiths.)
          </p>
        </Card>

        {/* ── Growth vs the valley ───────────────────────────────────── */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Growth vs. the valley</h2>
          <p className="text-xs text-muted max-w-3xl">
            Are we outpacing the Lehigh Valley&rsquo;s population growth (gaining a larger share, i.e. genuinely
            reaching new people) or just keeping pace? Our growth is the year-over-year change in average weekly
            in-person attendance (from{" "}
            <a href="/attendance" className="text-accent hover:underline">Attendance</a>).
          </p>
          {ourGrowthPct == null ? (
            <p className="text-xs text-subtle">
              Not enough attendance history yet — import at least ~2 years on the{" "}
              <a href="/attendance" className="text-accent hover:underline">Attendance</a> page to see this.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Weekly attendance" value={(attendance.inPerson12moAvg ?? 0).toLocaleString()} sub="in-person, last 12 mo avg" />
                <Stat label="Our growth (YoY)" value={`${ourGrowthPct > 0 ? "+" : ""}${ourGrowthPct}%`} sub="vs prior 12 months" />
                <Stat label="Valley pop. growth" value={`+${popGrowthPct}%`} sub="Lehigh Valley, per year" />
                <Stat
                  label={ourGrowthPct > popGrowthPct ? "Gaining ground" : "Falling behind"}
                  value={`${(ourGrowthPct - popGrowthPct >= 0 ? "+" : "")}${(ourGrowthPct - popGrowthPct).toFixed(1)} pts`}
                  sub={ourGrowthPct > popGrowthPct ? "growing faster than population" : "slower than population growth"}
                />
              </div>
              <p className="text-[11px] text-subtle max-w-3xl">
                {ourGrowthPct > popGrowthPct
                  ? `At +${ourGrowthPct}% a year vs the valley's ~+${popGrowthPct}% population growth, Faith is gaining a larger share of the area — outpacing the rate at which the unchurched pool grows, so the valley is becoming (slightly) more churched through us.`
                  : `At +${ourGrowthPct}% a year, Faith is growing about as fast as — or slower than — the valley's ~+${popGrowthPct}% population growth, so our share of the area is roughly flat; the unchurched pool is growing at least as fast as we're reaching it.`}
                {" "}(Population growth is the Lehigh Valley&rsquo;s 2010–2020 census rate; attendance YoY is in-person, excluding closures.)
              </p>
            </>
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
