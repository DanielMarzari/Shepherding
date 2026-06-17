import "server-only";
import { getDb } from "./db";
import { CHURCH } from "./geocode";
import { clampToValidArea } from "./lehigh-valley";
import { LV_TRACTS, LV_CENSUS_META, type TractProps } from "./lv-census";
import { SURROUNDING_TRACTS } from "./surrounding-tracts";
import { countyOf, COUNTY_STATS } from "./pa-counties";

const AVG_COST = LV_CENSUS_META.avgHomeValue;
// Protestant church counts × an assumed avg congregation size → a rough
// "seating capacity" for judging how saturated an area already is.
const PROT_AVG = LV_CENSUS_META.protestantAvgSize;

// Census/need analysis: join our people's homes to Lehigh Valley census
// tracts, estimate churched vs unchurched, how much of the valley we
// reach, where the biggest unreached need is, and a need-weighted second
// campus. Population is real (2020 Census); "churched" is the 2020 US
// Religion Census county adherence rate applied per tract.

export interface CensusTract extends TractProps {
  churched: number;
  unchurched: number;
  ourCount: number;
  reachPct: number; // our people / tract population
  need: number; // unchurched, discounted by our presence AND existing churches
  churchSat: number; // existing-church capacity (count × avg size) / population, 0–1
}

export interface NeedCampus {
  lat: number;
  lng: number;
  servedNeed: number; // unchurched people in tracts it's closest to
  estCost: number; // est. area property cost (median home value) at the site
}

export interface CensusAnalysis {
  population: number;
  churched: number;
  unchurched: number;
  churchedPct: number;
  ourMembers: number;
  reachedTracts: number;
  totalTracts: number;
  reachedPopulationPct: number; // share of LV population in tracts where we have anyone
  shareOfPopulationPct: number; // our people / LV population
  shareOfChurchedPct: number; // our people / churched population
  /** Lifetime reach: EVERY geocoded person on file who lives in the LV… */
  lifetimeInLV: number;
  /** …as a share of the whole valley's population. */
  lifetimeReachPct: number;
  /** Valley tracts (headline + campus planner). */
  tracts: CensusTract[];
  /** Surrounding 5 counties' tracts — same metrics, for this page's map. */
  surroundingTracts: CensusTract[];
  topNeed: CensusTract[];
  needCampus: NeedCampus | null;
  source: string;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, poly: number[][][]): boolean {
  if (!poly.length || !pointInRing(lng, lat, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(lng, lat, poly[i])) return false;
  return true;
}

interface PreparedTract {
  props: TractProps;
  polys: number[][][][]; // list of polygons (each [outer, ...holes])
  bbox: BBox;
}

/** Geoid prefix → Lehigh (42077) or Northampton (42095) = the Valley itself. */
const isLVGeoid = (geoid: string) => geoid.startsWith("42077") || geoid.startsWith("42095");

function prepareTracts(): PreparedTract[] {
  // The Valley's own tracts plus the five surrounding counties' tracts — both
  // rendered as the same choropleth; the Valley still drives the headline stats.
  const features = [...LV_TRACTS.features, ...SURROUNDING_TRACTS.features];
  return features.map((f) => {
    const g = f.geometry;
    const polys: number[][][][] =
      g.type === "Polygon"
        ? [g.coordinates as unknown as number[][][]]
        : (g.coordinates as unknown as number[][][][]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) {
      for (const [x, y] of poly[0]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return { props: f.properties, polys, bbox: { minX, minY, maxX, maxY } };
  });
}

function tractOf(prepared: PreparedTract[], lat: number, lng: number): PreparedTract | null {
  for (const t of prepared) {
    const b = t.bbox;
    if (lng < b.minX || lng > b.maxX || lat < b.minY || lat > b.maxY) continue;
    if (t.polys.some((p) => pointInPolygon(lng, lat, p))) return t;
  }
  return null;
}

let _prepared: PreparedTract[] | null = null;
const getPrepared = () => (_prepared ??= prepareTracts());

/** Estimated area property cost (median home value) at a point — used to
 *  factor land cost into campus siting. Falls back to the LV average. */
export function propertyCostAt(lat: number, lng: number): number {
  const t = tractOf(getPrepared(), lat, lng);
  return t?.props.cost || AVG_COST;
}

/** Cache each geocoded home's census tract + county (point-in-polygon) so the
 *  analysis pages don't recompute it for ~25k homes on every request. Only
 *  touches rows never assigned or re-geocoded since — so after the first run
 *  it's a no-op. Safe to call on every read (self-healing) and from the cron. */
export function refreshGeoAssignments(orgId: number): void {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT person_id AS personId, lat, lng FROM person_geo
        WHERE org_id = ? AND status = 'ok' AND lat IS NOT NULL
          AND (geo_assigned_at IS NULL OR geo_assigned_at < geocoded_at
               -- in a county but not yet matched to a tract: re-check now that
               -- the surrounding-county tracts are part of the tract set.
               OR (tract_geoid IS NULL AND county_geoid IS NOT NULL))`,
    )
    .all(orgId) as Array<{ personId: string; lat: number; lng: number }>;
  if (pending.length === 0) return;
  const prepared = getPrepared();
  const upd = db.prepare(
    `UPDATE person_geo
        SET tract_geoid = ?, county_geoid = ?,
            geo_assigned_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE org_id = ? AND person_id = ?`,
  );
  const tx = db.transaction((rows: typeof pending) => {
    for (const r of rows) {
      const t = tractOf(prepared, r.lat, r.lng);
      upd.run(t?.props.geoid ?? null, countyOf(r.lat, r.lng), orgId, r.personId);
    }
  });
  tx(pending);
}

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface DrawModel {
  radiusMi: number; // our average member distance at the main campus
  captureRate: number; // our engaged people / population within that radius of FC
}

/** Model how well we draw people, from the main campus: within our average
 *  member distance, what share of the local population do we actually reach?
 *  A new campus is assumed to draw the unreached at the same rate. */
export function computeDrawModel(
  tracts: Array<{ clat: number; clng: number; pop: number }>,
  ourMembers: number,
  radiusMi: number,
): DrawModel {
  const r = radiusMi > 0 ? radiusMi : 10;
  let popWithin = 0;
  for (const t of tracts) {
    if (haversineMiles(CHURCH.lat, CHURCH.lng, t.clat, t.clng) <= r) popWithin += t.pop;
  }
  const captureRate = popWithin > 0 ? Math.min(1, ourMembers / popWithin) : 0;
  return { radiusMi: r, captureRate };
}

// The realistic ceiling for how churched an area can get isn't 100% — it's
// roughly the share who even identify as Christian. Pew's 2023–24 Religious
// Landscape Study puts Pennsylvania at 61% Christian (30% unaffiliated), so
// the addressable pool is the Christians NOT currently attending, not every
// "unchurched" resident. Beyond that, growth means converting non-Christians
// or (more likely) drawing members from other churches.
export const CHRISTIAN_IDENTITY_RATE = 0.61;
export const CAP_CHURCHED_RATE = CHRISTIAN_IDENTITY_RATE;

export interface GrowthModel {
  driveMinThreshold: number; // catchment = within this many OSRM driving minutes of FC
  pop: number;
  churched: number;
  unchurched: number;
  ourSize: number; // our engaged people within the catchment
  churches: number; // existing Protestant churches in the catchment
  peoplePerChurch: number; // churched ÷ churches
  ourShareOfChurched: number; // ourSize ÷ churched (0–1)
  ourLoadVsAvg: number; // ourSize ÷ peoplePerChurch (× an average church's load)
  capRate: number; // assumed churched-rate ceiling
  areaChurchedCap: number; // pop × capRate
  netNewHeadroom: number; // areaChurchedCap − current churched (new Christians still possible)
  interferenceCeiling: number; // ourSize + netNewHeadroom (beyond this, growth = transfer)
  healthyMax: number; // ourSize + all local unchurched (theoretical, ignores the cap)
  transferShareNow: number; // of gettable non-us people, share already in other churches (0–1)
}

/** Healthy-growth estimate for the MAIN campus: within our catchment, how
 *  much room is there to grow by reaching people who'd otherwise stay
 *  unchurched (net benefit to the valley) before further growth just
 *  redistributes existing Christians from other churches. */
export function computeGrowth(
  tracts: Array<{ clat: number; clng: number; pop: number; churched: number; unchurched: number; ourCount: number; churches: number; driveMin: number | null }>,
  driveMinThreshold: number,
): GrowthModel {
  const r = driveMinThreshold > 0 ? driveMinThreshold : 20;
  let pop = 0, churched = 0, unchurched = 0, ourSize = 0, churches = 0;
  for (const t of tracts) {
    // Catchment by real driving time from Faith Church (OSRM), not a circle.
    if (t.driveMin != null && t.driveMin <= r) {
      pop += t.pop; churched += t.churched; unchurched += t.unchurched; ourSize += t.ourCount; churches += t.churches;
    }
  }
  const otherChurched = Math.max(0, churched - ourSize);
  const peoplePerChurch = churches > 0 ? churched / churches : 0;
  const areaChurchedCap = pop * CAP_CHURCHED_RATE;
  const netNewHeadroom = Math.max(0, areaChurchedCap - churched);
  return {
    driveMinThreshold: r, pop, churched, unchurched, ourSize, churches,
    peoplePerChurch,
    ourShareOfChurched: churched > 0 ? ourSize / churched : 0,
    ourLoadVsAvg: peoplePerChurch > 0 ? ourSize / peoplePerChurch : 0,
    capRate: CAP_CHURCHED_RATE,
    areaChurchedCap,
    netNewHeadroom,
    interferenceCeiling: ourSize + netNewHeadroom,
    healthyMax: ourSize + unchurched,
    transferShareNow: otherChurched + unchurched > 0 ? otherChurched / (otherChurched + unchurched) : 0,
  };
}

export function analyzeCensus(orgId: number): CensusAnalysis {
  refreshGeoAssignments(orgId); // cheap no-op once homes are assigned
  const prepared = getPrepared();

  // Engaged people per tract — straight from the cached tract assignment.
  const counts = new Map<string, number>();
  let ourMembers = 0;
  const engagedRows = getDb()
    .prepare(
      `SELECT g.tract_geoid AS geoid, COUNT(*) AS n
         FROM person_geo g
         JOIN person_activity pa
           ON pa.org_id = g.org_id AND pa.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.tract_geoid IS NOT NULL
          AND pa.classification IN ('shepherded','active','present')
        GROUP BY g.tract_geoid`,
    )
    .all(orgId) as Array<{ geoid: string; n: number }>;
  for (const r of engagedRows) {
    counts.set(r.geoid, r.n);
    if (isLVGeoid(r.geoid)) ourMembers += r.n; // headline = Valley only
  }

  const allTracts: CensusTract[] = prepared.map((t) => {
    const p = t.props;
    const ourCount = counts.get(p.geoid) ?? 0;
    const churched = p.pop * p.rate;
    const unchurched = p.pop * (1 - p.rate);
    // Coverage saturates around reaching ~2% of a tract's population.
    const coverage = Math.min(1, ourCount / Math.max(20, p.pop * 0.02));
    // Existing-church saturation: count × county avg congregation size, vs
    // population. Areas already well-served by other churches are less of a
    // marginal need for us.
    const capacity = p.churches * PROT_AVG;
    const churchSat = p.pop > 0 ? Math.min(1, capacity / p.pop) : 0;
    const need = unchurched * (1 - coverage) * (1 - 0.7 * churchSat);
    return {
      ...p,
      churched,
      unchurched,
      ourCount,
      reachPct: p.pop > 0 ? (ourCount / p.pop) * 100 : 0,
      need,
      churchSat,
    } as CensusTract;
  });

  // Lifetime reach — every geocoded person (any classification) whose home
  // falls inside a LEHIGH-VALLEY tract, vs. the valley's total population.
  // (tract_geoid can now also be a surrounding-county tract, so filter to LV.)
  const lifetimeInLV = (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM person_geo
          WHERE org_id = ? AND status = 'ok'
            AND (tract_geoid LIKE '42077%' OR tract_geoid LIKE '42095%')`,
      )
      .get(orgId) as { n: number }
  ).n;

  // `tracts` = the Valley (drives the headline stats + campus planner, which
  // is unchanged); `surroundingTracts` = the 5 neighbors, for this page's map.
  const tracts = allTracts.filter((t) => isLVGeoid(t.geoid));
  const surroundingTracts = allTracts.filter((t) => !isLVGeoid(t.geoid));
  const population = tracts.reduce((a, t) => a + t.pop, 0);
  const churched = tracts.reduce((a, t) => a + t.churched, 0);
  const unchurched = population - churched;
  const reachedTracts = tracts.filter((t) => t.ourCount > 0).length;
  const reachedPop = tracts.filter((t) => t.ourCount > 0).reduce((a, t) => a + t.pop, 0);

  // Need-weighted second campus: over Valley tracts, constrained to the valley.
  const needCampus = siteNeedCampus(tracts);

  const topNeed = [...tracts].sort((a, b) => b.need - a.need).slice(0, 6);

  return {
    population,
    churched,
    unchurched,
    churchedPct: population > 0 ? (churched / population) * 100 : 0,
    ourMembers,
    reachedTracts,
    totalTracts: tracts.length,
    reachedPopulationPct: population > 0 ? (reachedPop / population) * 100 : 0,
    shareOfPopulationPct: population > 0 ? (ourMembers / population) * 100 : 0,
    shareOfChurchedPct: churched > 0 ? (ourMembers / churched) * 100 : 0,
    lifetimeInLV,
    lifetimeReachPct: population > 0 ? (lifetimeInLV / population) * 100 : 0,
    tracts,
    surroundingTracts,
    topNeed,
    needCampus,
    source: LV_CENSUS_META.source,
  };
}

// ── Reach by county (the Valley + its 5 neighbors) ──────────────────
export interface CountyReach {
  geoid: string;
  name: string;
  isValley: boolean;
  population: number;
  churchedPct: number;
  congregations: number;
  lifetimeCount: number; // every record placed in the county
  engagedCount: number; // currently shepherded/active/present
  lifetimeReachPct: number; // lifetime / population
  engagedReachPct: number; // engaged / population
  shareOfChurchedPct: number; // engaged / churched population
}
export interface CountyFinding {
  title: string;
  detail: string;
  tone: "up" | "down" | "neutral";
}
export interface CountyAnalysis {
  counties: CountyReach[];
  findings: CountyFinding[];
}

/** How far our reach extends across the Valley and its five neighboring
 *  counties — the same stats as the Valley, read from each home's cached
 *  county assignment (refreshGeoAssignments). */
export function analyzeCounties(orgId: number): CountyAnalysis {
  refreshGeoAssignments(orgId); // cheap no-op once homes are assigned
  const life = new Map<string, number>();
  const eng = new Map<string, number>();
  const rows = getDb()
    .prepare(
      `SELECT g.county_geoid AS geoid,
              COUNT(*) AS lifetime,
              SUM(CASE WHEN pa.classification IN ('shepherded','active','present') THEN 1 ELSE 0 END) AS engaged
         FROM person_geo g
         LEFT JOIN person_activity pa
           ON pa.org_id = g.org_id AND pa.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.county_geoid IS NOT NULL
        GROUP BY g.county_geoid`,
    )
    .all(orgId) as Array<{ geoid: string; lifetime: number; engaged: number }>;
  for (const r of rows) {
    life.set(r.geoid, r.lifetime);
    eng.set(r.geoid, r.engaged ?? 0);
  }

  const counties: CountyReach[] = Object.values(COUNTY_STATS)
    .map((s) => {
      const lifetimeCount = life.get(s.geoid) ?? 0;
      const engagedCount = eng.get(s.geoid) ?? 0;
      const churched = s.pop * s.rate;
      return {
        geoid: s.geoid,
        name: s.name,
        isValley: s.isValley,
        population: s.pop,
        churchedPct: s.rate * 100,
        congregations: s.congregations,
        lifetimeCount,
        engagedCount,
        lifetimeReachPct: (lifetimeCount / s.pop) * 100,
        engagedReachPct: (engagedCount / s.pop) * 100,
        shareOfChurchedPct: churched > 0 ? (engagedCount / churched) * 100 : 0,
      };
    })
    .sort((a, b) => b.lifetimeCount - a.lifetimeCount);

  // ── Findings ──────────────────────────────────────────────────────
  const findings: CountyFinding[] = [];
  const totalLife = counties.reduce((a, c) => a + c.lifetimeCount, 0);
  const valley = counties.filter((c) => c.isValley);
  const surrounding = counties.filter((c) => !c.isValley);
  const valleyLife = valley.reduce((a, c) => a + c.lifetimeCount, 0);
  if (totalLife > 0) {
    const valleyPct = Math.round((valleyLife / totalLife) * 100);
    findings.push({
      title: `${valleyPct}% of our reach is in the Valley`,
      detail: `${valleyLife.toLocaleString()} of the ${totalLife.toLocaleString()} people we've placed across these seven counties live in Lehigh or Northampton; the other ${(100 - valleyPct)}% spill into the surrounding five.`,
      tone: "neutral",
    });
  }
  const topSurround = surrounding[0];
  if (topSurround && topSurround.lifetimeCount > 0) {
    findings.push({
      title: `Biggest spillover: ${topSurround.name}`,
      detail: `${topSurround.lifetimeCount.toLocaleString()} people who've touched us live in ${topSurround.name} County — ${topSurround.lifetimeReachPct.toFixed(2)}% of its ${topSurround.population.toLocaleString()} residents.`,
      tone: "up",
    });
  }
  const reachedSurround = surrounding.filter((c) => c.lifetimeCount > 0).length;
  findings.push({
    title: `Present in ${reachedSurround} of 5 neighbors`,
    detail: `We have at least one person on file in ${reachedSurround} of the five counties bordering the Valley${reachedSurround < 5 ? " — room to grow outward." : "."}`,
    tone: reachedSurround >= 3 ? "up" : "neutral",
  });
  // Most-unreached neighbor: lowest reach where a sizable unchurched base exists.
  const leastReached = [...surrounding].sort((a, b) => a.lifetimeReachPct - b.lifetimeReachPct)[0];
  if (leastReached) {
    const unchurched = Math.round(leastReached.population * (1 - leastReached.churchedPct / 100));
    findings.push({
      title: `Least-reached: ${leastReached.name}`,
      detail: `${leastReached.name} County has the thinnest reach (${leastReached.lifetimeReachPct.toFixed(2)}% of residents) yet ~${unchurched.toLocaleString()} unchurched people.`,
      tone: "down",
    });
  }
  return { counties, findings };
}

function siteNeedCampus(tracts: CensusTract[]): NeedCampus | null {
  // We're siting a campus to reach the UNREACHED, not to sit near our
  // current people. Weight a tract by:
  //   need        — unchurched people, discounted where we already have presence
  //   × cost      — boosted where land is cheaper (sqrt(avgCost/cost))
  //   × distance  — boosted the farther it is from Faith Church, since those
  //                 unchurched are the ones FC isn't already positioned to reach.
  const pts = tracts
    .filter((t) => t.need > 0 && t.clat && t.clng)
    .map((t) => {
      const distFC = haversineMiles(CHURCH.lat, CHURCH.lng, t.clat, t.clng);
      const distFactor = 0.5 + Math.min(distFC, 22) / 6; // ~0.5 near FC → ~4.2 far out
      const costFactor = Math.sqrt(AVG_COST / Math.max(50000, t.cost));
      return { ...t, w0: t.need * costFactor * distFactor };
    });
  if (pts.length < 5) return null;
  const sumW = pts.reduce((a, t) => a + t.w0, 0) || 1;
  let lat = pts.reduce((a, t) => a + t.clat * t.w0, 0) / sumW;
  let lng = pts.reduce((a, t) => a + t.clng * t.w0, 0) / sumW;
  for (let iter = 0; iter < 40; iter++) {
    let nLat = 0, nLng = 0, w = 0;
    for (const t of pts) {
      const d = Math.hypot(t.clat - lat, t.clng - lng) || 1e-9;
      const ww = t.w0 / d;
      nLat += t.clat * ww; nLng += t.clng * ww; w += ww;
    }
    const newLat = nLat / w, newLng = nLng / w;
    if (Math.hypot(newLat - lat, newLng - lng) < 1e-7) break;
    lat = newLat; lng = newLng;
  }
  const c = clampToValidArea(lat, lng);
  // Need it's closest to (vs. Faith Church).
  const servedNeed = tracts
    .filter((t) => haversineMiles(c.lat, c.lng, t.clat, t.clng) < haversineMiles(CHURCH.lat, CHURCH.lng, t.clat, t.clng))
    .reduce((a, t) => a + t.need, 0);
  return { lat: c.lat, lng: c.lng, servedNeed, estCost: propertyCostAt(c.lat, c.lng) };
}
