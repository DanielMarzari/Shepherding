import "server-only";
import { getDb } from "./db";
import { CHURCH } from "./geocode";

// Builds the road "web": one shared, weighted mesh of the segments homes
// drive from Faith Church. Each home is routed once (OSRM /route
// geometry), broken into quantized coordinate-pair segments, and folded
// into road_mesh (shared roads dedupe and accumulate usage). Dormant
// until OSRM_URL is set.

const OSRM_URL = process.env.OSRM_URL?.replace(/\/$/, "") ?? "";
const Q = 1e5; // quantize coords to 5 decimals (~1.1 m)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
         LEFT JOIN person_mesh m
           ON m.org_id = g.org_id AND m.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL
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
         LEFT JOIN person_mesh m
           ON m.org_id = g.org_id AND m.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL
          AND m.person_id IS NULL`,
    )
    .get(orgId) as { n: number };
  return row.n;
}

interface OsrmRoute {
  code: string;
  routes?: Array<{ geometry?: { coordinates?: [number, number][] } }>;
}

/** Route FC → home, return the road geometry as [lng,lat] vertices. */
async function routeGeometry(home: HomeRow): Promise<[number, number][] | null> {
  const url =
    `${OSRM_URL}/route/v1/driving/${CHURCH.lng},${CHURCH.lat};${home.lng},${home.lat}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const json = (await res.json()) as OsrmRoute;
  if (json.code !== "Ok") return null;
  return json.routes?.[0]?.geometry?.coordinates ?? null;
}

/** Fold a batch of not-yet-meshed homes into the shared mesh. */
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
  const upSeg = db.prepare(
    `INSERT INTO road_mesh (org_id, seg_key, ax, ay, bx, by, usage)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(org_id, seg_key) DO UPDATE SET usage = usage + 1`,
  );
  const markDone = db.prepare(
    `INSERT OR IGNORE INTO person_mesh (org_id, person_id) VALUES (?, ?)`,
  );

  let segments = 0;
  for (const home of homes) {
    let coords: [number, number][] | null = null;
    try {
      coords = await routeGeometry(home);
    } catch {
      coords = null;
    }
    const tx = db.transaction(() => {
      if (coords && coords.length >= 2) {
        for (let i = 0; i < coords.length - 1; i++) {
          const ax = q(coords[i][0]);
          const ay = q(coords[i][1]);
          const bx = q(coords[i + 1][0]);
          const by = q(coords[i + 1][1]);
          if (ax === bx && ay === by) continue;
          // Canonical order so A→B and B→A collapse to one segment.
          const aFirst = ax < bx || (ax === bx && ay <= by);
          const [x1, y1, x2, y2] = aFirst ? [ax, ay, bx, by] : [bx, by, ax, ay];
          upSeg.run(orgId, `${x1},${y1}|${x2},${y2}`, x1, y1, x2, y2);
          segments++;
        }
      }
      // Mark meshed regardless (a no-route home shouldn't be retried forever).
      markDone.run(orgId, home.person_id);
    });
    tx();
    await sleep(120); // rate-limit OSRM
  }
  return { processed: homes.length, segments, remaining: countPendingMesh(orgId) };
}

export interface MeshSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  usage: number;
}
export interface RoadMesh {
  segments: MeshSegment[];
  maxUsage: number;
  total: number;
  capped: boolean;
}

/** Read the mesh for rendering. Capped (highest-usage first) to protect
 *  the client; the cap mostly trims tiny single-home tips. */
export function getRoadMesh(orgId: number, max = 14000): RoadMesh {
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM road_mesh WHERE org_id = ?`).get(orgId) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(
      `SELECT ax, ay, bx, by, usage FROM road_mesh
        WHERE org_id = ? ORDER BY usage DESC LIMIT ?`,
    )
    .all(orgId, max) as MeshSegment[];
  const maxUsage = rows.length ? Math.max(...rows.map((r) => r.usage)) : 0;
  return { segments: rows, maxUsage, total, capped: total > rows.length };
}
