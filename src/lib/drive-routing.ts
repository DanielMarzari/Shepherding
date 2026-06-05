import "server-only";
import { getDb } from "./db";
import { CHURCH } from "./geocode";

// Driving distance/time from Faith Church to each home, via a local OSRM
// instance (a Pennsylvania OSM extract — see docs/osrm-setup.md). We use
// OSRM's `table` service: one request routes the church to up to ~90
// homes at once, returning distance + duration for each. Cheap compute,
// tiny storage (two numbers per person). Dormant until OSRM_URL is set.

const OSRM_URL = process.env.OSRM_URL?.replace(/\/$/, "") ?? "";
const CHUNK = 90; // homes per table request (OSRM max-table-size is 100)
const METERS_PER_MILE = 1609.344;

export function isRoutingConfigured(): boolean {
  return OSRM_URL.length > 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface HomeRow {
  person_id: string;
  lat: number;
  lng: number;
}

/** Geocoded homes whose drive hasn't been computed for their CURRENT
 *  coordinates (new, or moved since last run). */
function pendingHomes(orgId: number, limit: number): HomeRow[] {
  return getDb()
    .prepare(
      `SELECT g.person_id, g.lat, g.lng
         FROM person_geo g
         LEFT JOIN person_drive d
           ON d.org_id = g.org_id AND d.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL
          AND (d.person_id IS NULL OR d.lat != g.lat OR d.lng != g.lng)
        LIMIT ?`,
    )
    .all(orgId, limit) as HomeRow[];
}

export function countPendingDrive(orgId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM person_geo g
         LEFT JOIN person_drive d
           ON d.org_id = g.org_id AND d.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL
          AND (d.person_id IS NULL OR d.lat != g.lat OR d.lng != g.lng)`,
    )
    .get(orgId) as { n: number };
  return row.n;
}

interface OsrmTable {
  code: string;
  durations?: number[][]; // seconds; [source][dest]
  distances?: number[][]; // meters
}

/** Route the church → a chunk of homes. Returns per-home miles/minutes
 *  (null when that home couldn't be routed). */
async function routeChunk(
  homes: HomeRow[],
): Promise<Array<{ miles: number; minutes: number } | null>> {
  // coord 0 = church (source); 1..n = homes.
  const coords = [`${CHURCH.lng},${CHURCH.lat}`, ...homes.map((h) => `${h.lng},${h.lat}`)].join(";");
  const url =
    `${OSRM_URL}/table/v1/driving/${coords}` +
    `?sources=0&annotations=duration,distance`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const json = (await res.json()) as OsrmTable;
  if (json.code !== "Ok" || !json.durations?.[0]) {
    throw new Error(`OSRM table: ${json.code}`);
  }
  const durs = json.durations[0];
  const dists = json.distances?.[0];
  return homes.map((_, i) => {
    const sec = durs[i + 1];
    const m = dists?.[i + 1];
    if (sec == null || !Number.isFinite(sec)) return null;
    return {
      minutes: Math.round((sec / 60) * 10) / 10,
      miles: m != null ? Math.round((m / METERS_PER_MILE) * 10) / 10 : 0,
    };
  });
}

/** Compute drives for a batch of pending homes. Returns counts so a
 *  runner can loop until done. No-op (remaining unchanged) when OSRM
 *  isn't configured. */
export async function computeDrivesPending(
  orgId: number,
  limit = 270,
): Promise<{ processed: number; ok: number; remaining: number }> {
  if (!isRoutingConfigured()) {
    return { processed: 0, ok: 0, remaining: countPendingDrive(orgId) };
  }
  const homes = pendingHomes(orgId, limit);
  if (homes.length === 0) {
    return { processed: 0, ok: 0, remaining: countPendingDrive(orgId) };
  }

  const upsert = getDb().prepare(
    `INSERT INTO person_drive (org_id, person_id, lat, lng, miles, minutes, status, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, person_id) DO UPDATE SET
       lat = excluded.lat, lng = excluded.lng, miles = excluded.miles,
       minutes = excluded.minutes, status = excluded.status,
       computed_at = excluded.computed_at`,
  );

  let ok = 0;
  for (let i = 0; i < homes.length; i += CHUNK) {
    const chunk = homes.slice(i, i + CHUNK);
    let results: Array<{ miles: number; minutes: number } | null>;
    try {
      results = await routeChunk(chunk);
    } catch {
      // On a routing error, mark this chunk failed so the run terminates;
      // a later pass (or address change) re-attempts.
      results = chunk.map(() => null);
    }
    const tx = getDb().transaction(() => {
      chunk.forEach((h, j) => {
        const r = results[j];
        if (r) {
          upsert.run(orgId, h.person_id, h.lat, h.lng, r.miles, r.minutes, "ok");
          ok++;
        } else {
          upsert.run(orgId, h.person_id, h.lat, h.lng, null, null, "fail");
        }
      });
    });
    tx();
    if (i + CHUNK < homes.length) await sleep(50);
  }

  return { processed: homes.length, ok, remaining: countPendingDrive(orgId) };
}

export interface DriveStats {
  count: number;
  avgMinutes: number;
  avgMiles: number;
}
/** Per-person drive map for the analysis layer. */
export function getDriveMap(orgId: number): Map<string, { miles: number; minutes: number }> {
  const rows = getDb()
    .prepare(
      `SELECT person_id, miles, minutes FROM person_drive
        WHERE org_id = ? AND status = 'ok' AND minutes IS NOT NULL`,
    )
    .all(orgId) as Array<{ person_id: string; miles: number; minutes: number }>;
  const m = new Map<string, { miles: number; minutes: number }>();
  for (const r of rows) m.set(r.person_id, { miles: r.miles, minutes: r.minutes });
  return m;
}
