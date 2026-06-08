import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { CHURCH } from "./geocode";
import { getDriveMap } from "./drive-routing";
import { clampToValidArea } from "./lehigh-valley";
import { propertyCostAt } from "./census-analysis";

interface PIIBlob {
  address?: string | null;
}
interface Pt {
  personId: string;
  lat: number;
  lng: number;
  classification: string; // shepherded | active | present | inactive
  zip: string | null;
  driveMiles?: number;
  driveMinutes?: number;
  dFc: number; // straight-line miles to FC
  travelMin: number; // drive minutes (real) or estimate
}

const LOCAL_MPH = 28;

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 8) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export type Cohort = "all" | "shepherded" | "active" | "present" | "inactive";

export interface DistanceBand {
  label: string;
  midMiles: number;
  count: number;
  shepherdedPct: number;
}
export interface EngagementBin {
  label: string;
  midMinutes: number;
  count: number;
  shepherdedPct: number;
  engagedPct: number; // not inactive
}
export interface Insight {
  title: string;
  detail: string;
  tone: "up" | "down" | "neutral";
}
export interface SecondCampus {
  cohort: Cohort;
  lat: number;
  lng: number;
  label: string;
  avgMilesBefore: number;
  avgMilesAfter: number;
  served: number;
  estCost: number; // est. area property cost (median home value) at the site
}
export interface ReachAnalysis {
  count: number;
  usingDrive: boolean;
  avgMiles: number;
  medianMiles: number;
  estDriveMin: number;
  shepherdedCorr: number | null;
  shepherdedOfEngagedPct: number; // shepherded / (shepherded+active+present)
  bands: DistanceBand[];
  secondCampuses: SecondCampus[]; // one per cohort that qualifies
  engagementBins: EngagementBin[];
  maxHours: number;
  insights: Insight[];
}

function loadPoints(orgId: number): Pt[] {
  const rows = getDb()
    .prepare(
      `SELECT g.person_id AS personId, g.lat, g.lng, p.enc_pii AS encPii,
              COALESCE(pa.classification, 'inactive') AS classification
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
    classification: string;
  }>;
  const drive = getDriveMap(orgId);
  return rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const zip = pii?.address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
    const d = drive.get(r.personId);
    const dFc = haversineMiles(CHURCH.lat, CHURCH.lng, r.lat, r.lng);
    return {
      personId: r.personId,
      lat: r.lat,
      lng: r.lng,
      classification: r.classification,
      zip,
      driveMiles: d?.miles,
      driveMinutes: d?.minutes,
      dFc,
      travelMin: d?.minutes ?? (dFc / LOCAL_MPH) * 60,
    };
  });
}

/** Weighted geometric median (Weiszfeld) in lat/lng degrees. */
function weightedMedian(pts: Pt[], weight: (p: Pt) => number): { lat: number; lng: number } {
  let lat = mean(pts.map((p) => p.lat));
  let lng = mean(pts.map((p) => p.lng));
  for (let iter = 0; iter < 50; iter++) {
    let nLat = 0, nLng = 0, wsum = 0;
    for (const p of pts) {
      const w = weight(p) / (Math.hypot(p.lat - lat, p.lng - lng) || 1e-9);
      nLat += p.lat * w; nLng += p.lng * w; wsum += w;
    }
    const newLat = nLat / wsum, newLng = nLng / wsum;
    if (Math.hypot(newLat - lat, newLng - lng) < 1e-7) break;
    lat = newLat; lng = newLng;
  }
  return { lat, lng };
}

/** Site a second campus for one cohort, within the radius. Inactive
 *  people are weighted toward those who live FARTHER from Faith Church
 *  (the hypothesis: distance is why they drifted). */
function siteSecondCampus(
  cohortPts: Pt[],
  cohort: Cohort,
): SecondCampus | null {
  if (cohortPts.length < 10) return null;
  const weight =
    cohort === "inactive" ? (p: Pt) => Math.max(0.5, p.dFc) : () => 1;
  // Seed at the weighted median of the farther half so it doesn't collapse
  // onto Faith Church.
  const sortedFar = [...cohortPts].sort((a, b) => b.dFc - a.dFc);
  const seed = sortedFar.slice(0, Math.ceil(cohortPts.length / 2));
  let c2 = weightedMedian(seed, weight);
  let served: Pt[] = [];
  for (let iter = 0; iter < 12; iter++) {
    served = cohortPts.filter(
      (p) =>
        haversineMiles(c2.lat, c2.lng, p.lat, p.lng) <
        haversineMiles(CHURCH.lat, CHURCH.lng, p.lat, p.lng),
    );
    if (served.length < 5) break;
    c2 = weightedMedian(served, weight);
  }
  if (served.length < 5) return null;
  // The campus must sit inside the valid area (Lehigh Valley + 5 mi). If
  // the optimum landed outside, pull it to the nearest valid point and
  // recompute who it serves.
  c2 = clampToValidArea(c2.lat, c2.lng);
  served = cohortPts.filter(
    (p) =>
      haversineMiles(c2.lat, c2.lng, p.lat, p.lng) <
      haversineMiles(CHURCH.lat, CHURCH.lng, p.lat, p.lng),
  );
  if (served.length < 5) return null;
  const avgAfter = mean(
    cohortPts.map((p) =>
      Math.min(p.dFc, haversineMiles(c2.lat, c2.lng, p.lat, p.lng)),
    ),
  );
  const zc = new Map<string, number>();
  for (const p of served) if (p.zip) zc.set(p.zip, (zc.get(p.zip) ?? 0) + 1);
  const topZip = [...zc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    cohort,
    lat: c2.lat,
    lng: c2.lng,
    label: topZip ? `near ${topZip}` : "see marker",
    avgMilesBefore: mean(cohortPts.map((p) => p.dFc)),
    avgMilesAfter: avgAfter,
    served: served.length,
    estCost: propertyCostAt(c2.lat, c2.lng),
  };
}

export function analyzeReach(orgId: number, maxHours: number): ReachAnalysis {
  const pts = loadPoints(orgId);
  const insights: Insight[] = [];
  const base: ReachAnalysis = {
    count: pts.length,
    usingDrive: false,
    avgMiles: 0,
    medianMiles: 0,
    estDriveMin: 0,
    shepherdedCorr: null,
    shepherdedOfEngagedPct: 0,
    bands: [],
    secondCampuses: [],
    engagementBins: [],
    maxHours,
    insights,
  };
  if (pts.length < 8) return base;

  // Reach & distance is about the people we actually have: shepherded /
  // active / present, AND within the second-campus radius so far-flung
  // outliers don't skew the averages, correlation, or the curve.
  const maxMin = maxHours * 60;
  const ENGAGED = new Set(["shepherded", "active", "present"]);
  const reachPts = pts.filter(
    (p) => ENGAGED.has(p.classification) && p.travelMin <= maxMin,
  );

  const driveCount = reachPts.filter((p) => p.driveMiles != null).length;
  const usingDrive = driveCount >= 8 && driveCount >= reachPts.length * 0.5;
  const metric = reachPts.map((p) => (usingDrive && p.driveMiles != null ? p.driveMiles : p.dFc));
  const avgMiles = mean(metric);
  const medianMiles = median(metric);
  const driveMins = reachPts.filter((p) => p.driveMinutes != null).map((p) => p.driveMinutes!);
  const estDriveMin =
    usingDrive && driveMins.length > 0
      ? Math.round(mean(driveMins))
      : Math.round((avgMiles / LOCAL_MPH) * 60);

  const shepBin = reachPts.map((p) => (p.classification === "shepherded" ? 1 : 0));
  const corr = pearson(metric, shepBin);
  const shepCount = shepBin.reduce<number>((a, b) => a + b, 0);
  const shepherdedOfEngagedPct = reachPts.length
    ? Math.round((shepCount / reachPts.length) * 100)
    : 0;

  // Shepherded by distance — fine bands so it reads as one continuous
  // curve. midMiles anchors each point on a true distance axis. Bands need
  // a minimum sample so a 1-of-2 far band can't spike the curve to 50%.
  const MIN_BAND = 12;
  const bandDefs: Array<[string, number, number]> = [
    ["0–2", 0, 2], ["2–4", 2, 4], ["4–6", 4, 6], ["6–8", 6, 8],
    ["8–10", 8, 10], ["10–13", 10, 13], ["13–16", 13, 16],
    ["16–20", 16, 20], ["20–25", 20, 25], ["25–30", 25, 30], ["30+", 30, Infinity],
  ];
  const bands: DistanceBand[] = bandDefs
    .map(([label, lo, hi]) => {
      const sub = reachPts.filter((_, i) => metric[i] >= lo && metric[i] < hi);
      const shep = sub.filter((p) => p.classification === "shepherded").length;
      return {
        label,
        midMiles: hi === Infinity ? 33 : (lo + hi) / 2,
        count: sub.length,
        shepherdedPct: sub.length ? Math.round((shep / sub.length) * 100) : 0,
      };
    })
    .filter((b) => b.count >= MIN_BAND);

  // ── Engagement vs travel time (minutes). ──────────────────────────
  const binDefs: Array<[string, number, number]> = [
    ["0–10", 0, 10], ["10–20", 10, 20], ["20–30", 20, 30],
    ["30–45", 30, 45], ["45–60", 45, 60], ["60–90", 60, 90], ["90+", 90, Infinity],
  ];
  const engagementBins: EngagementBin[] = binDefs
    .map(([label, lo, hi]) => {
      const sub = pts.filter((p) => p.travelMin >= lo && p.travelMin < hi);
      const shep = sub.filter((p) => p.classification === "shepherded").length;
      const eng = sub.filter((p) => p.classification !== "inactive").length;
      return {
        label,
        midMinutes: hi === Infinity ? 100 : (lo + hi) / 2,
        count: sub.length,
        shepherdedPct: sub.length ? Math.round((shep / sub.length) * 100) : 0,
        engagedPct: sub.length ? Math.round((eng / sub.length) * 100) : 0,
      };
    })
    .filter((b) => b.count >= 3);

  // ── Second-campus siting per cohort, within the radius. ───────────
  const inRadius = pts.filter((p) => p.travelMin <= maxMin);
  const cohorts: Cohort[] = ["all", "shepherded", "active", "present", "inactive"];
  const secondCampuses: SecondCampus[] = [];
  for (const c of cohorts) {
    const cohortPts =
      c === "all" ? inRadius : inRadius.filter((p) => p.classification === c);
    const sc = siteSecondCampus(cohortPts, c);
    if (sc) secondCampuses.push(sc);
  }

  // ── Insights ───────────────────────────────────────────────────────
  insights.push({
    title: "Average reach",
    detail: usingDrive
      ? `Homes are about ${avgMiles.toFixed(1)} mi / ~${estDriveMin} min from Faith Church by road (median ${medianMiles.toFixed(1)} mi), from real OSRM routing.`
      : `Homes sit about ${avgMiles.toFixed(1)} mi from Faith Church on average (median ${medianMiles.toFixed(1)} mi) — ~${estDriveMin}-min drive (straight-line estimate).`,
    tone: "neutral",
  });
  if (corr != null) {
    insights.push({
      title:
        Math.abs(corr) < 0.1
          ? "Distance barely affects shepherding"
          : corr < 0
            ? "Closer homes are more likely to be shepherded"
            : "Farther homes are more likely to be shepherded",
      detail: `Distance and being shepherded correlate ${corr < 0 ? "negatively" : "positively"} (r = ${corr.toFixed(2)}), ~${Math.round(corr * corr * 100)}% of the variation.`,
      tone: "neutral",
    });
  }
  const inactiveSc = secondCampuses.find((s) => s.cohort === "inactive");
  if (inactiveSc) {
    insights.push({
      title: "Second campus could re-reach inactive folks",
      detail: `Weighting toward distant (still in-area) inactive homes, a campus ${inactiveSc.label} would be closer than Faith Church for ${inactiveSc.served.toLocaleString()} of them — average distance ${inactiveSc.avgMilesBefore.toFixed(1)} → ${inactiveSc.avgMilesAfter.toFixed(1)} mi. They may have drifted partly because of the drive.`,
      tone: "up",
    });
  }

  return {
    ...base,
    count: reachPts.length, // engaged people within the radius (the basis for these stats)
    usingDrive,
    avgMiles,
    medianMiles,
    estDriveMin,
    shepherdedCorr: corr,
    shepherdedOfEngagedPct,
    bands,
    secondCampuses,
    engagementBins,
  };
}
