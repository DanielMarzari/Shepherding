import "server-only";
import { getDb } from "./db";
import { CHURCH } from "./geocode";

// Builds the road "network": the set of named roads any household drives
// from Faith Church, each stored ONCE. We route each engaged home (OSRM
// /route with steps), and fold each named step (a stretch of road) into
// road_network keyed by name + quantized endpoints — shared stretches
// collapse to one row. A road's presence means it's needed; there is no
// usage weighting. Dormant until OSRM_URL is set.

const OSRM_URL = process.env.OSRM_URL?.replace(/\/$/, "") ?? "";
const Q = 1e4; // quantize endpoints to 4 decimals (~11 m) for the dedupe key
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The network is "your people's" roads: shepherded / active / present.
const ENGAGED = "('shepherded','active','present')";

export function isMeshConfigured(): boolean {
  return OSRM_URL.length > 0;
}

const q = (n: number) => Math.round(n * Q) / Q;

interface HomeRow {
  person_id: string;
  lat: number;
  lng: number;
}

function pendingHomes(orgId: number, limit: number): HomeRow[] {
  return getDb()
    .prepare(
      `SELECT g.person_id, g.lat, g.lng
         FROM person_geo g
         JOIN person_activity pa
           ON pa.org_id = g.org_id AND pa.person_id = g.person_id
         LEFT JOIN person_mesh m
           ON m.org_id = g.org_id AND m.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL
          AND pa.classification IN ${ENGAGED}
          AND m.person_id IS NULL
        LIMIT ?`,
    )
    .all(orgId, limit) as HomeRow[];
}

export function countPendingMesh(orgId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM person_geo g
         JOIN person_activity pa
           ON pa.org_id = g.org_id AND pa.person_id = g.person_id
         LEFT JOIN person_mesh m
           ON m.org_id = g.org_id AND m.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL
          AND pa.classification IN ${ENGAGED}
          AND m.person_id IS NULL`,
    )
    .get(orgId) as { n: number };
  return row.n;
}

interface OsrmStep {
  name?: string;
  geometry?: { coordinates?: [number, number][] };
}
interface OsrmRouteSteps {
  code: string;
  routes?: Array<{ legs?: Array<{ steps?: OsrmStep[] }> }>;
}

/** Route FC → home and return the named road steps (each a stretch of a
 *  single road, with its geometry as [lng,lat] vertices). */
async function routeSteps(home: HomeRow): Promise<OsrmStep[] | null> {
  const url =
    `${OSRM_URL}/route/v1/driving/${CHURCH.lng},${CHURCH.lat};${home.lng},${home.lat}` +
    `?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const json = (await res.json()) as OsrmRouteSteps;
  if (json.code !== "Ok") return null;
  return json.routes?.[0]?.legs?.flatMap((l) => l.steps ?? []) ?? [];
}

/** Fold a batch of not-yet-meshed engaged homes into the road network. */
export async function buildMeshPending(
  orgId: number,
  limit = 60,
): Promise<{ processed: number; segments: number; remaining: number }> {
  if (!isMeshConfigured()) {
    return { processed: 0, segments: 0, remaining: countPendingMesh(orgId) };
  }
  const homes = pendingHomes(orgId, limit);
  if (homes.length === 0) {
    return { processed: 0, segments: 0, remaining: countPendingMesh(orgId) };
  }
  const db = getDb();
  const upRoad = db.prepare(
    `INSERT INTO road_network (org_id, road_key, name, geom)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(org_id, road_key) DO NOTHING`,
  );
  const markDone = db.prepare(
    `INSERT OR IGNORE INTO person_mesh (org_id, person_id) VALUES (?, ?)`,
  );

  let added = 0;
  for (const home of homes) {
    let steps: OsrmStep[] | null = null;
    try {
      steps = await routeSteps(home);
    } catch {
      steps = null;
    }
    const tx = db.transaction(() => {
      for (const step of steps ?? []) {
        const coords = step.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;
        const a = coords[0];
        const b = coords[coords.length - 1];
        const name = step.name?.trim() || "road";
        // Dedupe: same named stretch (same endpoints, ~11m) → one row.
        const key = `${name}|${q(a[0])},${q(a[1])}|${q(b[0])},${q(b[1])}`;
        const info = upRoad.run(orgId, key, name, JSON.stringify(coords));
        if (info.changes > 0) added++;
      }
      markDone.run(orgId, home.person_id);
    });
    tx();
    await sleep(120); // rate-limit OSRM
  }
  return { processed: homes.length, segments: added, remaining: countPendingMesh(orgId) };
}

export interface RoadLine {
  name: string;
  /** Polyline as [lat, lng] pairs, ready for Leaflet. */
  coords: [number, number][];
}
export interface RoadNetwork {
  roads: RoadLine[];
  total: number;
  capped: boolean;
}

/** Read the road network for rendering. Each road is one polyline. */
export function getRoadMesh(orgId: number, max = 40000): RoadNetwork {
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM road_network WHERE org_id = ?`).get(orgId) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(`SELECT name, geom FROM road_network WHERE org_id = ? LIMIT ?`)
    .all(orgId, max) as Array<{ name: string | null; geom: string }>;
  const roads: RoadLine[] = [];
  for (const r of rows) {
    try {
      const c = JSON.parse(r.geom) as [number, number][];
      if (c.length >= 2) {
        roads.push({ name: r.name ?? "road", coords: c.map(([lng, lat]) => [lat, lng]) });
      }
    } catch {
      /* skip malformed */
    }
  }
  return { roads, total, capped: total > rows.length };
}
