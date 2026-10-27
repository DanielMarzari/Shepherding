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
  // ~12.4 ac, estimated from satellite (~900 × 600 ft); used as the
  // "comparable or larger" lot-size target for the property search.
  lotAcres: 12.4 as number | null,
  lotNote: "≈ estimated from satellite (~900 × 600 ft)",
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
  /** True when they're in at least one active group. */
  inGroup: boolean;
  /** True when they're on at least one active team. */
  inTeam: boolean;
  /** True when they belong to a PCO household (a proxy for "family"). */
  hasHousehold: boolean;
  /** Raw PCO gender string (e.g. "Male" / "Female"), or null. */
  gender: string | null;
  /** Birth year (for age brackets), or null. */
  birthYear: number | null;
  /** True when PCO marks them a parent. */
  isParent: boolean;
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

/** The five-digit ZIP inside a free-text address, or null. The map labels a
 *  second-campus marker with it ("near 18104"); nothing else reads it. */
export function zipOf(address: string | null | undefined): string | null {
  return address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
}

/** Fill person_geo.zip for rows written before 0112 added the column.
 *
 *  This is the one place that decrypts to get a ZIP, it runs in the nightly
 *  refresh, and after the first pass it matches no rows. The map used to do
 *  this work for all 25,834 geocoded people on every single request.
 */
export function backfillGeoZips(orgId: number): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT g.person_id AS personId, p.enc_pii AS encPii
         FROM person_geo g
         JOIN pco_people p ON p.org_id = g.org_id AND p.pco_id = g.person_id
        WHERE g.org_id = ? AND g.zip IS NULL AND g.status = 'ok'
          AND p.enc_pii IS NOT NULL`,
    )
    .all(orgId) as Array<{ personId: string; encPii: string | null }>;
  if (rows.length === 0) return 0;

  const update = db.prepare(
    `UPDATE person_geo SET zip = ? WHERE org_id = ? AND person_id = ?`,
  );
  let filled = 0;
  db.transaction(() => {
    for (const r of rows) {
      const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
      const zip = zipOf(pii?.address);
      if (!zip) continue;
      update.run(zip, orgId, r.personId);
      filled++;
    }
  })();
  return filled;
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
    `INSERT INTO person_geo (org_id, person_id, addr_hash, lat, lng, status, zip, geocoded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, person_id) DO UPDATE SET
       addr_hash = excluded.addr_hash, lat = excluded.lat, lng = excluded.lng,
       status = excluded.status, zip = excluded.zip,
       geocoded_at = excluded.geocoded_at`,
  );

  let matched = 0;
  for (const r of rows) {
    const pii = r.enc_pii ? decryptJson<PIIBlob>(r.enc_pii) : null;
    const address = pii?.address?.trim() || null;
    if (!address) {
      upsert.run(orgId, r.pco_id, null, null, null, "noaddr", null);
      continue;
    }
    // Stored now, while the address is already decrypted in hand, so that
    // reading the map later needs no key at all.
    const zip = zipOf(address);
    const { coords, cached } = await geocodeAddress(address);
    if (coords) {
      upsert.run(orgId, r.pco_id, hmac(normAddr(address)), coords.lat, coords.lng, "ok", zip);
      matched++;
    } else {
      upsert.run(orgId, r.pco_id, hmac(normAddr(address)), null, null, "nomatch", zip);
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
              p.first_name AS firstName, p.last_name AS lastName,
              p.gender AS gender, p.birth_year AS birthYear, p.is_parent AS isParent,
              COALESCE(pa.classification, 'unknown') AS classification,
              COALESCE(pa.active_group_count, 0) AS groupCount,
              COALESCE(pa.active_team_count, 0) AS teamCount,
              CASE WHEN EXISTS (
                SELECT 1 FROM pco_household_memberships hm
                 WHERE hm.org_id = g.org_id AND hm.person_id = g.person_id
              ) THEN 1 ELSE 0 END AS inHousehold
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
    firstName: string | null;
    lastName: string | null;
    classification: string;
    groupCount: number;
    teamCount: number;
    inHousehold: number;
    gender: string | null;
    birthYear: number | null;
    isParent: number | null;
  }>;
  return rows.map((r) => {
    // first_name / last_name are plaintext columns (0074). Only a record
    // written before that backfill still needs the key, and there are none
    // left on production — this used to decrypt all 25,834 every request.
    let name = [r.firstName, r.lastName].filter(Boolean).join(" ");
    if (!name && r.encPii) {
      const pii = decryptJson<PIIBlob>(r.encPii);
      name = [pii?.first_name, pii?.last_name].filter(Boolean).join(" ");
    }
    return {
      name: name || "Member",
      lat: r.lat,
      lng: r.lng,
      classification: r.classification,
      isMember: isMemberType(r.mt),
      inGroup: r.groupCount > 0,
      inTeam: r.teamCount > 0,
      hasHousehold: r.inHousehold === 1,
      gender: r.gender,
      birthYear: r.birthYear,
      isParent: r.isParent === 1,
    };
  });
}
