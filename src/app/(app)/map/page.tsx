import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { CHURCH, countPendingGeo, getMemberGeoPoints } from "@/lib/geocode";
import { analyzeReach } from "@/lib/map-analysis";
import { analyzeCensus } from "@/lib/census-analysis";
import { getMapSettings } from "@/lib/map-settings";
import { countPendingDrive, isRoutingConfigured } from "@/lib/drive-routing";
import { countPendingMesh, getRoadMesh } from "@/lib/road-mesh";
import { MemberMap } from "./member-map";
import { GeocodeButton } from "./geocode-button";
import { DriveButton } from "./drive-button";
import { MeshButton } from "./mesh-button";
import { EngagementChart } from "./engagement-chart";
import { DistanceBandChart } from "./distance-band-chart";

export default async function MapPage() {
  const session = await requireOrg();
  const points = getMemberGeoPoints(session.orgId);
  const pending = countPendingGeo(session.orgId);
  const mapSettings = getMapSettings(session.orgId);
  const reach = analyzeReach(session.orgId, mapSettings.secondCampusMaxHours);
  const routingOn = isRoutingConfigured();
  const drivePending = routingOn ? countPendingDrive(session.orgId) : 0;
  const meshPending = routingOn ? countPendingMesh(session.orgId) : 0;
  const mesh = getRoadMesh(session.orgId);
  const census = analyzeCensus(session.orgId);
  const isAdmin = session.role === "admin";

  return (
    <AppShell active="See more" breadcrumb="See more › Map">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Member map</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Where your people live, anchored on {CHURCH.name} ({CHURCH.address}).
            Color by shepherding category or membership type. Addresses are
            geocoded with the free US Census geocoder — coordinates stay on the
            server and are only shown to signed-in staff.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-muted">
          <span>
            {points.length.toLocaleString()} plotted
            {pending > 0 && (
              <span className="text-subtle"> · {pending.toLocaleString()} not geocoded yet</span>
            )}
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            {routingOn && <MeshButton pending={meshPending} isAdmin={isAdmin} />}
            {routingOn && <DriveButton pending={drivePending} isAdmin={isAdmin} />}
            <GeocodeButton pending={pending} isAdmin={isAdmin} />
          </div>
        </div>

        {/* ── Map 1: where people live ───────────────────────────────── */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Where your people live</h2>
          {points.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              No addresses geocoded yet.{" "}
              {isAdmin
                ? "Click “Geocode all addresses” above — it runs through the whole directory and the map fills in."
                : "An admin needs to run geocoding first."}
            </div>
          ) : (
            <MemberMap church={CHURCH} points={points} mode="members" />
          )}
        </Card>

        {/* ── Reach & distance analysis ──────────────────────────────── */}
        {reach.count >= 8 && (
          <Card className="p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Reach &amp; distance</h2>
              <span className="text-xs text-subtle">
                straight-line from {CHURCH.name}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Avg distance" value={`${reach.avgMiles.toFixed(1)} mi`} sub={`median ${reach.medianMiles.toFixed(1)} mi`} />
              <Stat
                label={reach.usingDrive ? "Avg drive" : "Est. drive"}
                value={`~${reach.estDriveMin} min`}
                sub={reach.usingDrive ? "real road routing" : "rough, not road routing"}
              />
              <Stat
                label="Distance ↔ shepherded"
                value={reach.shepherdedCorr == null ? "—" : `r ${reach.shepherdedCorr.toFixed(2)}`}
                sub="point-biserial"
              />
              <Stat label="People analyzed" value={reach.count.toLocaleString()} sub={`shepherded/active/present · ≤${mapSettings.secondCampusMaxHours}h`} />
            </div>

            {reach.bands.length >= 2 && (
              <div>
                <div className="text-xs text-muted mb-1.5">Shepherded by distance</div>
                <DistanceBandChart bands={reach.bands} />
              </div>
            )}

            {reach.insights.length > 0 && (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {reach.insights.map((ins, i) => (
                  <li key={i} className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          ins.tone === "up"
                            ? "bg-good-soft-fg"
                            : ins.tone === "down"
                              ? "bg-warn-soft-fg"
                              : "bg-muted"
                        }`}
                      />
                      <span className="text-sm font-medium">{ins.title}</span>
                    </div>
                    <p className="text-xs text-muted mt-1 leading-relaxed">{ins.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-subtle">
              {reach.usingDrive
                ? "Distances and times are real driving routes from a local OSRM instance (Pennsylvania road data). The second-campus siting uses straight-line distance."
                : routingOn
                  ? "Distances are straight-line for now — click “Compute driving distances” to switch to real road routing."
                  : "Distances are straight-line (great-circle). Set OSRM_URL to a local routing instance (see docs/osrm-setup.md) for real driving distance and time."}
            </p>
          </Card>
        )}

        {/* ── Map 2: roads driven (the web) ──────────────────────────── */}
        {routingOn && (
          <Card className="p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold">Roads driven to Faith Church</h2>
              <span className="text-xs text-subtle">
                {mesh.total > 0
                  ? `${mesh.total.toLocaleString()} roads`
                  : "not built yet"}
                {meshPending > 0 && (
                  <span> · {meshPending.toLocaleString()} homes not added</span>
                )}
              </span>
            </div>
            <p className="text-xs text-muted max-w-2xl">
              The network of roads your people (shepherded/active/present)
              drive to Faith Church — each road appears once; its presence
              means a household needs it to get here.
            </p>
            {mesh.roads.length > 0 ? (
              <MemberMap
                church={CHURCH}
                points={points}
                mesh={{ roads: mesh.roads }}
                mode="roads"
              />
            ) : (
              <div className="py-10 text-center text-sm text-muted">
                {isAdmin
                  ? "Click “Build road web” above — it routes each geocoded home and assembles the mesh (runs in the background)."
                  : "An admin needs to build the road web first."}
              </div>
            )}
          </Card>
        )}

        {/* ── Map 3 + planner: second campus ─────────────────────────── */}
        {reach.secondCampuses.length > 0 && (
          <Card className="p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold">Proposed second campus</h2>
              <span className="text-xs text-subtle">
                excludes homes &gt; {mapSettings.secondCampusMaxHours}h away ·{" "}
                <a href="/metrics" className="text-accent hover:underline">
                  change in Metrics
                </a>
              </span>
            </div>
            <p className="text-xs text-muted max-w-2xl">
              The best spot for a second location to serve each group — switch
              cohorts with “Plan for” on the map. The{" "}
              <span className="text-fg">inactive</span> option is weighted
              toward people who live farther out (the hypothesis being
              distance is part of why they drifted).
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
                    <th className="text-right font-medium py-1.5">Avg distance</th>
                  </tr>
                </thead>
                <tbody>
                  {reach.secondCampuses.map((sc) => (
                    <tr key={sc.cohort} className="border-b border-border-softer">
                      <td className="py-2 pr-4 capitalize">
                        {sc.cohort === "all" ? "Everyone" : sc.cohort}
                      </td>
                      <td className="py-2 pr-4 text-muted">{sc.label}</td>
                      <td className="py-2 pr-4 text-right tnum">
                        {sc.served.toLocaleString()} homes
                      </td>
                      <td className="py-2 text-right tnum">
                        {sc.avgMilesBefore.toFixed(1)} → {sc.avgMilesAfter.toFixed(1)} mi
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── Census: churched vs unchurched + areas of need ─────────── */}
        <Card className="p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold">Reaching the Lehigh Valley</h2>
            <span className="text-xs text-subtle">{census.source}</span>
          </div>
          <p className="text-xs text-muted max-w-2xl">
            How much of the Lehigh Valley is churched vs. unchurched, how much
            of it Faith Church already reaches, and where the biggest
            unreached need is. The choropleth colors each census tract — switch
            between need, unchurched population, and our reach. The purple
            marker is where a second campus would best center the unmet need.
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
                      ~{Math.round(t.unchurched).toLocaleString()} unchurched · {t.ourCount} of our people
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {census.needCampus && (
            <p className="text-[11px] text-subtle">
              A need-based second campus (purple) sited within the valid area
              would be closer than Faith Church for roughly{" "}
              {Math.round(census.needCampus.servedNeed).toLocaleString()} unchurched
              residents — complementing the people-based siting above.
            </p>
          )}
        </Card>

        {/* ── Engagement vs travel time ──────────────────────────────── */}
        {reach.engagementBins.length >= 2 && (
          <Card className="p-5 space-y-2">
            <h2 className="text-sm font-semibold">Engagement vs. travel time</h2>
            <p className="text-xs text-muted max-w-2xl">
              Does living farther from Faith Church make people less likely to
              get connected? Each band is the share of homes at that drive time
              who are shepherded (in a group/team) or engaged at all.
            </p>
            <EngagementChart bins={reach.engagementBins} />
          </Card>
        )}

        {pending > 0 && isAdmin && (
          <p className="text-xs text-subtle max-w-2xl">
            Geocoding everyone in the directory with a real address (placeholder
            and address-less records are skipped). It runs in the background in
            rate-limited batches and continues on its own — you only start it
            once, and it also tops up automatically after each nightly sync.
          </p>
        )}
      </div>
    </AppShell>
  );
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
