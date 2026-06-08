import "server-only";
import { getDb } from "./db";
import { CHURCH } from "./geocode";
import { clampToValidArea } from "./lehigh-valley";
import { LV_TRACTS, LV_CENSUS_META, type TractProps } from "./lv-census";

const AVG_COST = LV_CENSUS_META.avgHomeValue;

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
  need: number; // unchurched, discounted where we already have presence
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
  tracts: CensusTract[];
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

function prepareTracts(): PreparedTract[] {
  return LV_TRACTS.features.map((f) => {
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

function loadEngagedHomes(orgId: number): Array<{ lat: number; lng: number }> {
  return getDb()
    .prepare(
      `SELECT g.lat, g.lng
         FROM person_geo g
         JOIN person_activity pa
           ON pa.org_id = g.org_id AND pa.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL
          AND pa.classification IN ('shepherded','active','present')`,
    )
    .all(orgId) as Array<{ lat: number; lng: number }>;
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

export function analyzeCensus(orgId: number): CensusAnalysis {
  const prepared = getPrepared();
  const counts = new Map<string, number>();
  const homes = loadEngagedHomes(orgId);
  let ourMembers = 0;
  for (const h of homes) {
    const t = tractOf(prepared, h.lat, h.lng);
    if (t) {
      counts.set(t.props.geoid, (counts.get(t.props.geoid) ?? 0) + 1);
      ourMembers++;
    }
  }

  const tracts: CensusTract[] = prepared.map((t) => {
    const p = t.props;
    const ourCount = counts.get(p.geoid) ?? 0;
    const churched = p.pop * p.rate;
    const unchurched = p.pop * (1 - p.rate);
    // Coverage saturates around reaching ~2% of a tract's population.
    const coverage = Math.min(1, ourCount / Math.max(20, p.pop * 0.02));
    const need = unchurched * (1 - coverage);
    return {
      ...p,
      churched,
      unchurched,
      ourCount,
      reachPct: p.pop > 0 ? (ourCount / p.pop) * 100 : 0,
      need,
    } as CensusTract;
  });

  const population = tracts.reduce((a, t) => a + t.pop, 0);
  const churched = tracts.reduce((a, t) => a + t.churched, 0);
  const unchurched = population - churched;
  const reachedTracts = tracts.filter((t) => t.ourCount > 0).length;
  const reachedPop = tracts.filter((t) => t.ourCount > 0).reduce((a, t) => a + t.pop, 0);

  // Need-weighted second campus: geometric median of tract centroids
  // weighted by need, then constrained to the valid area.
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
    tracts,
    topNeed,
    needCampus,
    source: LV_CENSUS_META.source,
  };
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
