import "server-only";
import { getDb } from "./db";
import { decryptJson, hmac } from "./encryption";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
  address?: string | null;
}

/** The church — the map's anchor point. */
export const CHURCH = {
  name: "Faith Church",
  address: "6528 Hamilton Blvd, Allentown, PA 18106",
  lat: 40.554494951328,
  lng: -75.584432833772,
};

/** Faith Church campus profile for the planner's "current campuses" card.
 *  Building size is the documented 2020 three-story addition (total is
 *  larger); lot size and market value aren't public (churches are tax-
 *  exempt), so those link out to county records rather than guess. */
export const FAITH_CHURCH_PROFILE = {
  denomination: "Evangelical Free (EFCA)",
  buildingSqft: 50652, // 2020 three-story addition (per Beers+Hoffman); total building is larger
  buildingNote: "2020 three-story addition; total building is larger",
  lotAcres: null as number | null,
  estMarketValue: null as number | null,
  parcelUrl: "https://www.lehighcounty.org/Departments/Assessment",
  satelliteUrl: `https://www.google.com/maps/search/?api=1&query=${CHURCH.lat},${CHURCH.lng}`,
};

/** Polite delay between live geocoder calls (cache hits don't wait). */
export const GEOCODE_DELAY_MS = 120;

export interface MemberPoint {
  lat: number;
  lng: number;
  name: string;
  classification: string;
  /** True when their PCO membership type marks them an actual member
   *  (vs. attender / visitor / non-member). */
  isMember: boolean;
}

/** Heuristic: a "member" membership type (not non-/former-member). */
export function isMemberType(mt: string | null): boolean {
  if (!mt) return false;
  const l = mt.toLowerCase();
  return l.includes("member") && !l.includes("non") && !l.includes("former");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normAddr(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Geocode one address via the free US Census geocoder (no API key),
 *  cached by the address HMAC. `cached` is true when we answered from
 *  the cache (so the caller can skip the rate-limit delay). */
async function geocodeAddress(
  address: string,
): Promise<{ coords: { lat: number; lng: number } | null; cached: boolean }> {
  const norm = normAddr(address);
  if (!norm) return { coords: null, cached: true };
  const key = hmac(norm);
  const db = getDb();
  const cached = db
    .prepare(`SELECT lat, lng, ok FROM geocode_cache WHERE addr_hash = ?`)
    .get(key) as { lat: number | null; lng: number | null; ok: number } | undefined;
  if (cached) {
    return {
      coords:
        cached.ok && cached.lat != null && cached.lng != null
          ? { lat: cached.lat, lng: cached.lng }
          : null,
      cached: true,
    };
  }

  let lat: number | null = null;
  let lng: number | null = null;
  try {
    const url =
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
      `?address=${encodeURIComponent(address)}` +
      `&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { next: { revalidate: 2_592_000 } }); // 30d
    if (res.ok) {
      const json = (await res.json()) as {
        result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number } }> };
      };
      const c = json.result?.addressMatches?.[0]?.coordinates;
      if (c) {
        lat = c.y;
        lng = c.x;
      }
    }
  } catch {
    // Network/parse failure — caller marks nomatch so the run terminates;
    // a later re-geocode (address change) can retry. Don't cache it.
    return { coords: null, cached: false };
  }

  const ok = lat != null && lng != null;
  db.prepare(
    `INSERT OR REPLACE INTO geocode_cache (addr_hash, lat, lng, ok)
     VALUES (?, ?, ?, ?)`,
  ).run(key, lat, lng, ok ? 1 : 0);
  return { coords: ok ? { lat: lat!, lng: lng! } : null, cached: false };
}

interface PendingRow {
  pco_id: string;
  enc_pii: string | null;
}

/** Geocode a batch of not-yet-located people across the WHOLE directory
 *  (anyone with no person_geo row, minus PCO placeholder accounts).
 *  Rate-limited: waits `delayMs` after each live geocoder call. */
export async function geocodePending(
  orgId: number,
  limit = 50,
  delayMs = GEOCODE_DELAY_MS,
): Promise<{ processed: number; matched: number; remaining: number }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.pco_id, p.enc_pii
         FROM pco_people p
         LEFT JOIN person_geo g
           ON g.org_id = p.org_id AND g.person_id = p.pco_id
        WHERE p.org_id = ?
          AND g.person_id IS NULL
          AND (p.membership_type IS NULL
               OR lower(p.membership_type) NOT LIKE '%system use%')
        LIMIT ?`,
    )
    .all(orgId, limit) as PendingRow[];

  const upsert = db.prepare(
    `INSERT INTO person_geo (org_id, person_id, addr_hash, lat, lng, status, geocoded_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, person_id) DO UPDATE SET
       addr_hash = excluded.addr_hash, lat = excluded.lat, lng = excluded.lng,
       status = excluded.status, geocoded_at = excluded.geocoded_at`,
  );

  let matched = 0;
  for (const r of rows) {
    const pii = r.enc_pii ? decryptJson<PIIBlob>(r.enc_pii) : null;
    const address = pii?.address?.trim() || null;
    if (!address) {
      upsert.run(orgId, r.pco_id, null, null, null, "noaddr");
      continue;
    }
    const { coords, cached } = await geocodeAddress(address);
    if (coords) {
      upsert.run(orgId, r.pco_id, hmac(normAddr(address)), coords.lat, coords.lng, "ok");
      matched++;
    } else {
      upsert.run(orgId, r.pco_id, hmac(normAddr(address)), null, null, "nomatch");
    }
    if (!cached && delayMs > 0) await sleep(delayMs);
  }

  return { processed: rows.length, matched, remaining: countPendingGeo(orgId) };
}

/** Everyone in the directory not yet geocoded (no person_geo row). */
export function countPendingGeo(orgId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM pco_people p
         LEFT JOIN person_geo g
           ON g.org_id = p.org_id AND g.person_id = p.pco_id
        WHERE p.org_id = ?
          AND g.person_id IS NULL
          AND (p.membership_type IS NULL
               OR lower(p.membership_type) NOT LIKE '%system use%')`,
    )
    .get(orgId) as { n: number };
  return row.n;
}

/** All geocoded member points for the map (status 'ok'), with name +
 *  classification for the hover/legend. */
export function getMemberGeoPoints(orgId: number): MemberPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT g.lat, g.lng, p.enc_pii AS encPii, p.membership_type AS mt,
              COALESCE(pa.classification, 'inactive') AS classification
         FROM person_geo g
         JOIN pco_people p
           ON p.org_id = g.org_id AND p.pco_id = g.person_id
         LEFT JOIN person_activity pa
           ON pa.org_id = g.org_id AND pa.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL`,
    )
    .all(orgId) as Array<{
    lat: number;
    lng: number;
    encPii: string | null;
    mt: string | null;
    classification: string;
  }>;
  return rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const name =
      [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") || "Member";
    return {
      lat: r.lat,
      lng: r.lng,
      name,
      classification: r.classification,
      isMember: isMemberType(r.mt),
    };
  });
}
