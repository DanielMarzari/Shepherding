import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { CHURCH } from "./geocode";
import { getDriveMap } from "./drive-routing";

interface PIIBlob {
  address?: string | null;
}
interface Pt {
  personId: string;
  lat: number;
  lng: number;
  shepherded: boolean;
  zip: string | null;
  driveMiles?: number;
  driveMinutes?: number;
}

const LOCAL_MPH = 28; // rough average for local/suburban driving

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 8) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export interface DistanceBand {
  label: string;
  count: number;
  shepherdedPct: number;
}
export interface Insight {
  title: string;
  detail: string;
  tone: "up" | "down" | "neutral";
}
export interface SecondCampus {
  lat: number;
  lng: number;
  label: string;
  avgMilesBefore: number;
  avgMilesAfter: number;
  served: number;
}
export interface ReachAnalysis {
  count: number;
  /** True when ≥ half the homes have real OSRM driving distances (so the
   *  numbers below are driving, not straight-line). */
  usingDrive: boolean;
  avgMiles: number;
  medianMiles: number;
  /** Avg minutes: real driving time when usingDrive, else an estimate. */
  estDriveMin: number;
  shepherdedCorr: number | null;
  bands: DistanceBand[];
  secondCampus: SecondCampus | null;
  insights: Insight[];
}

function loadPoints(orgId: number): Pt[] {
  const rows = getDb()
    .prepare(
      `SELECT g.person_id AS personId, g.lat, g.lng, p.enc_pii AS encPii,
              CASE WHEN pa.classification = 'shepherded' THEN 1 ELSE 0 END AS shep
         FROM person_geo g
         JOIN pco_people p ON p.org_id = g.org_id AND p.pco_id = g.person_id
         LEFT JOIN person_activity pa
           ON pa.org_id = g.org_id AND pa.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL`,
    )
    .all(orgId) as Array<{
    personId: string;
    lat: number;
    lng: number;
    encPii: string | null;
    shep: number;
  }>;
  const drive = getDriveMap(orgId);
  return rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const zip = pii?.address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
    const d = drive.get(r.personId);
    return {
      personId: r.personId,
      lat: r.lat,
      lng: r.lng,
      shepherded: r.shep === 1,
      zip,
      driveMiles: d?.miles,
      driveMinutes: d?.minutes,
    };
  });
}

/** Geometric median (Weiszfeld) in lat/lng degrees — fine over a metro
 *  area. Used to site a hypothetical second campus. */
function geometricMedian(pts: Pt[]): { lat: number; lng: number } {
  let lat = mean(pts.map((p) => p.lat));
  let lng = mean(pts.map((p) => p.lng));
  for (let iter = 0; iter < 40; iter++) {
    let nLat = 0;
    let nLng = 0;
    let wsum = 0;
    for (const p of pts) {
      const d = Math.hypot(p.lat - lat, p.lng - lng) || 1e-9;
      const w = 1 / d;
      nLat += p.lat * w;
      nLng += p.lng * w;
      wsum += w;
    }
    const newLat = nLat / wsum;
    const newLng = nLng / wsum;
    if (Math.hypot(newLat - lat, newLng - lng) < 1e-7) break;
    lat = newLat;
    lng = newLng;
  }
  return { lat, lng };
}

export function analyzeReach(orgId: number): ReachAnalysis {
  const pts = loadPoints(orgId);
  const insights: Insight[] = [];
  if (pts.length < 8) {
    return {
      count: pts.length,
      usingDrive: false,
      avgMiles: 0,
      medianMiles: 0,
      estDriveMin: 0,
      shepherdedCorr: null,
      bands: [],
      secondCampus: null,
      insights,
    };
  }

  // Straight-line distances (always) — used for the second-campus siting.
  const hav = pts.map((p) => haversineMiles(CHURCH.lat, CHURCH.lng, p.lat, p.lng));
  // Prefer real driving distances when we have them for most homes.
  const driveCount = pts.filter((p) => p.driveMiles != null).length;
  const usingDrive = driveCount >= 8 && driveCount >= pts.length * 0.5;
  const dists = pts.map((p, i) =>
    usingDrive && p.driveMiles != null ? p.driveMiles : hav[i],
  );
  const avgMiles = mean(dists);
  const medianMiles = median(dists);
  const driveMins = pts
    .filter((p) => p.driveMinutes != null)
    .map((p) => p.driveMinutes!);
  const estDriveMin =
    usingDrive && driveMins.length > 0
      ? Math.round(mean(driveMins))
      : Math.round((avgMiles / LOCAL_MPH) * 60);

  // Distance vs shepherding (point-biserial correlation).
  const shepBin = pts.map((p) => (p.shepherded ? 1 : 0));
  const corr = pearson(dists, shepBin);

  // Shepherded rate by distance band.
  const bandDefs: Array<[string, number, number]> = [
    ["0–2 mi", 0, 2],
    ["2–5 mi", 2, 5],
    ["5–10 mi", 5, 10],
    ["10–20 mi", 10, 20],
    ["20+ mi", 20, Infinity],
  ];
  const bands: DistanceBand[] = bandDefs
    .map(([label, lo, hi]) => {
      const idx = dists
        .map((d, i) => ({ d, i }))
        .filter((x) => x.d >= lo && x.d < hi);
      const count = idx.length;
      const shep = idx.filter((x) => pts[x.i].shepherded).length;
      return {
        label,
        count,
        shepherdedPct: count ? Math.round((shep / count) * 100) : 0,
      };
    })
    .filter((b) => b.count > 0);

  // ── Second-campus suggestion: a 2-median with FC fixed. ────────────
  let secondCampus: SecondCampus | null = null;
  if (pts.length >= 30) {
    // Seed the 2nd center at the geometric median of the farther half.
    const sorted = [...pts.map((p, i) => ({ p, d: hav[i] }))].sort(
      (a, b) => b.d - a.d,
    );
    const far = sorted.slice(0, Math.ceil(sorted.length / 2)).map((x) => x.p);
    let c2 = geometricMedian(far);
    let served: Pt[] = [];
    for (let iter = 0; iter < 12; iter++) {
      served = pts.filter((p) => {
        const dFc = haversineMiles(CHURCH.lat, CHURCH.lng, p.lat, p.lng);
        const d2 = haversineMiles(c2.lat, c2.lng, p.lat, p.lng);
        return d2 < dFc;
      });
      if (served.length < 5) break;
      c2 = geometricMedian(served);
    }
    if (served.length >= 5) {
      const avgAfter = mean(
        pts.map((p) =>
          Math.min(
            haversineMiles(CHURCH.lat, CHURCH.lng, p.lat, p.lng),
            haversineMiles(c2.lat, c2.lng, p.lat, p.lng),
          ),
        ),
      );
      // Human label = the most common zip among the served homes.
      const zipCount = new Map<string, number>();
      for (const p of served)
        if (p.zip) zipCount.set(p.zip, (zipCount.get(p.zip) ?? 0) + 1);
      const topZip =
        [...zipCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      secondCampus = {
        lat: c2.lat,
        lng: c2.lng,
        label: topZip ? `near ${topZip}` : "see marker",
        avgMilesBefore: mean(hav),
        avgMilesAfter: avgAfter,
        served: served.length,
      };
    }
  }

  // ── Insights ───────────────────────────────────────────────────────
  insights.push({
    title: "Average reach",
    detail: usingDrive
      ? `Homes are about ${avgMiles.toFixed(1)} mi / ~${estDriveMin} min from Faith Church by road (median ${medianMiles.toFixed(1)} mi), from real OSRM driving routes.`
      : `Homes sit about ${avgMiles.toFixed(1)} mi from Faith Church on average (median ${medianMiles.toFixed(1)} mi) — roughly a ${estDriveMin}-minute drive (straight-line estimate, not road routing).`,
    tone: "neutral",
  });
  if (corr != null) {
    const r2 = Math.round(corr * corr * 100);
    insights.push({
      title:
        Math.abs(corr) < 0.1
          ? "Distance barely affects shepherding"
          : corr < 0
            ? "Closer homes are more likely to be shepherded"
            : "Farther homes are more likely to be shepherded",
      detail: `Distance-from-church and being shepherded correlate ${corr < 0 ? "negatively" : "positively"} (r = ${corr.toFixed(2)}), so distance accounts for about ${r2}% of the variation. ${
        corr < 0
          ? "People who live closer tend to be more connected."
          : Math.abs(corr) < 0.1
            ? "Where someone lives has little to do with whether they're shepherded."
            : ""
      }`,
      tone: "neutral",
    });
  }
  if (bands.length >= 2) {
    const near = bands[0];
    const far = bands[bands.length - 1];
    insights.push({
      title: "Shepherding by distance",
      detail: `${near.shepherdedPct}% of homes within ${near.label.replace(" mi", " miles")} are shepherded vs ${far.shepherdedPct}% of those ${far.label.replace(" mi", " miles")} out.`,
      tone: "neutral",
    });
  }
  if (secondCampus) {
    insights.push({
      title: "Possible second campus",
      detail: `A second location ${secondCampus.label} would be closer than Faith Church for ${secondCampus.served.toLocaleString()} homes, cutting the average distance from ${secondCampus.avgMilesBefore.toFixed(1)} mi to ${secondCampus.avgMilesAfter.toFixed(1)} mi. Marked on the map.`,
      tone: "up",
    });
  }

  return {
    count: pts.length,
    usingDrive,
    avgMiles,
    medianMiles,
    estDriveMin,
    shepherdedCorr: corr,
    bands,
    secondCampus,
    insights,
  };
}
