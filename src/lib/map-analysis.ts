import "server-only";
import { getDb } from "./db";
import { CHURCH } from "./geocode";
import { getDriveMap } from "./drive-routing";
import { clampToValidArea } from "./lehigh-valley";
import { propertyCostAt } from "./census-analysis";

interface Pt {
  personId: string;
  lat: number;
  lng: number;
  classification: string; // shepherded | known | unknown
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

export type Cohort = "all" | "shepherded" | "known" | "unknown";

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
      `SELECT g.person_id AS personId, g.lat, g.lng, g.zip AS zip,
              COALESCE(pa.classification, 'unknown') AS classification
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
    zip: string | null;
    classification: string;
  }>;
  const drive = getDriveMap(orgId);
  // No decryption here on purpose. This used to open every one of the
  // 25,834 geocoded people's PII blobs, on every request, for a ZIP that
  // labels one marker. The ZIP now lives on person_geo (0112); a null is
  // simply no label, which is what an unparseable address always gave.
  return rows.map((r) => {
    const zip = r.zip;
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

/** Weighted geometric median (Weiszfeld), in lat/lng degrees.
 *
 *  The point that minimises the total weighted distance to every home — the
 *  place that is least far from everyone, which is not the average position.
 *  Each pass re-weights every home by one over its distance to the current
 *  guess and moves the guess to that weighted average; it walks downhill to
 *  the answer in a handful of passes.
 *
 *  Written over typed arrays with no closure per point, and with sqrt rather
 *  than Math.hypot, which is overflow-safe and about five times slower for
 *  it. On production this is 6.4x faster than the loop it replaces and
 *  returns the same coordinates to five decimals — about a metre.
 */
function weightedMedian(
  la: Float64Array,
  ln: Float64Array,
  wt: Float64Array,
  n: number,
): { lat: number; lng: number } {
  let lat = 0, lng = 0;
  for (let i = 0; i < n; i++) {
    lat += la[i];
    lng += ln[i];
  }
  lat /= n;
  lng /= n;
  for (let iter = 0; iter < 50; iter++) {
    let nLat = 0, nLng = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      const dx = la[i] - lat, dy = ln[i] - lng;
      const d = Math.sqrt(dx * dx + dy * dy);
      const w = wt[i] / (d || 1e-9);
      nLat += la[i] * w;
      nLng += ln[i] * w;
      wsum += w;
    }
    const newLat = nLat / wsum, newLng = nLng / wsum;
    const mx = newLat - lat, my = newLng - lng;
    lat = newLat;
    lng = newLng;
    // Converges well before 50 passes — about 30 on this data — and the
    // break is what makes that true rather than the cap.
    if (Math.sqrt(mx * mx + my * my) < 1e-7) break;
  }
  return { lat, lng };
}

/** Below this, the bearings are too evenly spread for a direction to mean
 *  anything and the polar seed is skipped. Measured on this congregation:
 *  0.649, strongly one way (south-west). */
const CONCENTRATED = 0.35;

/** Miles per degree of latitude — close enough over one valley. */
const MI_PER_DEG = 69.0;

/** A first guess at the campus, in polar coordinates around the church:
 *  the median distance out, along the mean bearing. Returns null when the
 *  homes ring the church too evenly for a bearing to describe them. */
function polarSeed(
  cohortPts: Pt[],
  la: Float64Array,
  ln: Float64Array,
  dfc: Float64Array,
  n: number,
): { lat: number; lng: number } | null {
  const cosLat = Math.cos((CHURCH.lat * Math.PI) / 180);
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const dy = la[i] - CHURCH.lat;
    const dx = (ln[i] - CHURCH.lng) * cosLat;
    const h = Math.sqrt(dx * dx + dy * dy);
    if (h === 0) continue;
    sx += dx / h;
    sy += dy / h;
  }
  const resultant = Math.sqrt(sx * sx + sy * sy) / n;
  if (resultant < CONCENTRATED) return null;

  const radii = Float64Array.from(dfc.subarray(0, n));
  radii.sort();
  const rStar = radii[Math.floor(n / 2)];
  const theta = Math.atan2(sy, sx);
  return {
    lat: CHURCH.lat + (rStar * Math.sin(theta)) / MI_PER_DEG,
    lng: CHURCH.lng + (rStar * Math.cos(theta)) / (MI_PER_DEG * cosLat),
  };
}

/** Site a second campus for one cohort, within the radius.
 *
 *  Seed at the geometric median of the farther half of the cohort, so the
 *  answer does not simply collapse onto Faith Church. Then repeat: work out
 *  who this candidate would be closer to than Faith Church is, and move the
 *  candidate to that group's geometric median. It settles in a few rounds.
 *
 *  Unknown people are weighted toward those who live farther out — the
 *  hypothesis being that distance is part of why they drifted.
 */
function siteSecondCampus(
  cohortPts: Pt[],
  cohort: Cohort,
): SecondCampus | null {
  const n = cohortPts.length;
  if (n < 10) return null;

  const la = new Float64Array(n), ln = new Float64Array(n);
  const wt = new Float64Array(n), dfc = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = cohortPts[i];
    la[i] = p.lat;
    ln[i] = p.lng;
    dfc[i] = p.dFc;
    wt[i] = cohort === "unknown" ? Math.max(0.5, p.dFc) : 1;
  }

  // Seed in polar coordinates around the church: how far out, and which
  // way. The distance is the median of everyone's distance — sort, take the
  // middle. The direction is the circular mean of their bearings: sum the
  // unit vectors and take the angle of the result. Both are one pass, and
  // the seed lands about half a mile from where the walk below ends up, so
  // the walk has little left to do.
  //
  // An eigenvector would give the axis people lie along, which cannot tell
  // southwest from northeast; the resultant vector gives the direction.
  //
  // The length of that resultant says whether a direction means anything:
  // near 1 the congregation lies one way, near 0 it rings the church evenly
  // and no single bearing describes it. Below CONCENTRATED we fall back to
  // the old seed — the median of the farther half — which assumes nothing
  // about shape.
  const seed = polarSeed(cohortPts, la, ln, dfc, n);
  let c2: { lat: number; lng: number };
  if (seed) {
    c2 = seed;
  } else {
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => dfc[b] - dfc[a],
    );
    const half = Math.ceil(n / 2);
    const sLa = new Float64Array(half), sLn = new Float64Array(half);
    const sWt = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      const j = order[i];
      sLa[i] = la[j];
      sLn[i] = ln[j];
      sWt[i] = wt[j];
    }
    c2 = weightedMedian(sLa, sLn, sWt, half);
  }

  // Scratch buffers for "who this campus would serve", reused each round
  // rather than reallocated.
  const kLa = new Float64Array(n), kLn = new Float64Array(n);
  const kWt = new Float64Array(n);
  let servedN = 0;
  const gather = () => {
    servedN = 0;
    for (let i = 0; i < n; i++) {
      if (haversineMiles(c2.lat, c2.lng, la[i], ln[i]) < dfc[i]) {
        kLa[servedN] = la[i];
        kLn[servedN] = ln[i];
        kWt[servedN] = wt[i];
        servedN++;
      }
    }
  };

  for (let iter = 0; iter < 12; iter++) {
    gather();
    if (servedN < 5) break;
    const prev = c2;
    c2 = weightedMedian(kLa, kLn, kWt, servedN);
    // Stop once the campus stops moving — about a metre.
    if (Math.abs(prev.lat - c2.lat) < 1e-5 && Math.abs(prev.lng - c2.lng) < 1e-5) break;
  }
  if (servedN < 5) return null;

  // The campus must sit inside the valid area (Lehigh Valley + 5 mi). If
  // the optimum landed outside, pull it to the nearest valid point and
  // recompute who it serves.
  c2 = clampToValidArea(c2.lat, c2.lng);
  gather();
  if (servedN < 5) return null;

  let sumBefore = 0, sumAfter = 0;
  for (let i = 0; i < n; i++) {
    sumBefore += dfc[i];
    sumAfter += Math.min(dfc[i], haversineMiles(c2.lat, c2.lng, la[i], ln[i]));
  }

  const zc = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (haversineMiles(c2.lat, c2.lng, la[i], ln[i]) >= dfc[i]) continue;
    const z = cohortPts[i].zip;
    if (z) zc.set(z, (zc.get(z) ?? 0) + 1);
  }
  const topZip = [...zc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    cohort,
    lat: c2.lat,
    lng: c2.lng,
    label: topZip ? `near ${topZip}` : "see marker",
    avgMilesBefore: sumBefore / n,
    avgMilesAfter: sumAfter / n,
    served: servedN,
    estCost: propertyCostAt(c2.lat, c2.lng),
  };
}

/** What the analysis was computed from — the content, not a timestamp.
 *
 *  Homes almost never move. The first version of this keyed on the activity
 *  snapshot's refresh time, which changes every night whether or not anybody
 *  moved, so it recomputed nightly for an answer that was already correct.
 *  This is a fingerprint of the things the answer actually depends on: how
 *  many homes sit in each cohort and where they are, plus the drive times
 *  that decide who falls inside the radius. Rounded sums are enough to catch
 *  a change; they are a fingerprint, not a checksum.
 */
function reachSignature(orgId: number): string {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT COALESCE(pa.classification,'unknown') AS cls,
              COUNT(*) AS n,
              CAST(SUM(g.lat) * 1000 AS INTEGER) AS sLat,
              CAST(SUM(g.lng) * 1000 AS INTEGER) AS sLng
         FROM person_geo g
         LEFT JOIN person_activity pa
           ON pa.org_id = g.org_id AND pa.person_id = g.person_id
        WHERE g.org_id = ? AND g.status = 'ok' AND g.lat IS NOT NULL
        GROUP BY cls ORDER BY cls`,
    )
    .all(orgId) as Array<{ cls: string; n: number; sLat: number; sLng: number }>;
  const d = db
    .prepare(
      `SELECT COUNT(*) AS n, CAST(COALESCE(SUM(minutes),0) AS INTEGER) AS mins
         FROM person_drive_from_church
        WHERE org_id = ? AND status = 'ok' AND minutes IS NOT NULL`,
    )
    .get(orgId) as { n: number; mins: number };
  const parts = rows.map((r) => `${r.cls}=${r.n}/${r.sLat}/${r.sLng}`);
  return `${parts.join(",")}|${d.n}/${d.mins}`;
}

/** True when the cached answer is still the answer. */
export function reachCacheFresh(orgId: number, maxHours: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT signature FROM map_reach_cache WHERE org_id = ? AND max_hours = ?`,
    )
    .get(orgId, maxHours) as { signature: string } | undefined;
  return !!row && row.signature === reachSignature(orgId);
}

/** The reach analysis, from cache when its inputs haven't moved.
 *
 *  A miss computes and stores it, because a page with no cached answer has
 *  to show something; the nightly refresh keeps it warm so that almost never
 *  happens on somebody's request.
 */
export function getReachAnalysis(orgId: number, maxHours: number): ReachAnalysis {
  const db = getDb();
  const sig = reachSignature(orgId);
  const row = db
    .prepare(
      `SELECT payload FROM map_reach_cache
        WHERE org_id = ? AND max_hours = ? AND signature = ?`,
    )
    .get(orgId, maxHours, sig) as { payload: string } | undefined;
  if (row) {
    try {
      return JSON.parse(row.payload) as ReachAnalysis;
    } catch {
      /* fall through and rebuild */
    }
  }
  return rebuildReachAnalysis(orgId, maxHours);
}

/** Compute it and store it. Called by the nightly refresh, and by a read
 *  that found nothing usable. */
export function rebuildReachAnalysis(
  orgId: number,
  maxHours: number,
): ReachAnalysis {
  const started = Date.now();
  const result = analyzeReach(orgId, maxHours);
  getDb()
    .prepare(
      `INSERT INTO map_reach_cache (org_id, max_hours, signature, payload, built_ms, built_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, max_hours) DO UPDATE SET
         signature = excluded.signature, payload = excluded.payload,
         built_ms = excluded.built_ms, built_at = excluded.built_at`,
    )
    .run(orgId, maxHours, reachSignature(orgId), JSON.stringify(result), Date.now() - started);
  return result;
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
  const ENGAGED = new Set(["shepherded", "known"]);
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
      const eng = sub.filter((p) => p.classification !== "unknown").length;
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
  const cohorts: Cohort[] = ["all", "shepherded", "known", "unknown"];
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
  const inactiveSc = secondCampuses.find((s) => s.cohort === "unknown");
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
