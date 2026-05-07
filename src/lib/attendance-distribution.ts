import "server-only";

/**
 * Population distribution across attendance frequency buckets.
 *
 *   • bucket[0] ("Every week") = the actual measured weekly attendance W.
 *   • bucket[1..n] = a geometric decay summing to (expected − W).
 *   • Total = expected (live PCO records).
 *
 * Solve W × (r + r² + … + rⁿ) = (E − W) for ratio r ∈ (0, 1] via binary
 * search. When E ≤ W everyone fits in the every-week bucket; when (E−W)
 * is too large for a decaying series we fall back to a uniform-ish tail.
 */

export interface FrequencyBucket {
  label: string;
  visitsPerYear: number;
  people: number;
  pct: number;
}

const BUCKETS = [
  { label: "Every week", visitsPerYear: 52 },
  { label: "Almost weekly", visitsPerYear: 40 },
  { label: "Twice a month", visitsPerYear: 26 },
  { label: "Monthly", visitsPerYear: 12 },
  { label: "Every 6 weeks", visitsPerYear: 8 },
  { label: "Quarterly", visitsPerYear: 4 },
  { label: "Twice a year", visitsPerYear: 2 },
  { label: "Once a year", visitsPerYear: 1 },
] as const;

export interface DistributionResult {
  buckets: FrequencyBucket[];
  /** Implied weekly attendance from the curve (sum of people × visits/52).
   *  Reported for sanity-checking — bucket[0] is set to targetWeekly. */
  impliedWeekly: number;
  targetWeekly: number;
  expected: number;
  /** Decay ratio (0..1) used for buckets after the first. 1 = uniform tail. */
  decayRatio: number;
}

export function buildAttendanceDistribution(
  expected: number,
  weekly: number,
): DistributionResult | null {
  if (expected <= 0 || !weekly || weekly <= 0) return null;
  const W = Math.min(weekly, expected);
  const tailTotal = expected - W;
  const tailBuckets = BUCKETS.length - 1; // 7

  // Solve for ratio r such that W × (r + r² + … + r^7) = tailTotal.
  let r: number;
  if (tailTotal <= 0) {
    r = 0;
  } else {
    const targetSum = tailTotal / W;
    if (targetSum >= tailBuckets) {
      // Uniform tail can't reach (would need r > 1); cap at uniform and the
      // first bucket will be inflated to absorb the rest.
      r = 1;
    } else {
      // Binary search r in (0, 1) so r + r² + … + r⁷ = targetSum.
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        let s = 0;
        let p = mid;
        for (let k = 0; k < tailBuckets; k++) {
          s += p;
          p *= mid;
        }
        if (Math.abs(s - targetSum) < 1e-6) {
          lo = hi = mid;
          break;
        }
        if (s < targetSum) lo = mid;
        else hi = mid;
      }
      r = (lo + hi) / 2;
    }
  }

  // Build the float allocation.
  const float: number[] = new Array(BUCKETS.length).fill(0);
  float[0] = W;
  if (tailTotal > 0 && r === 1) {
    // Uniform tail; first bucket may absorb extra
    const each = tailTotal / tailBuckets;
    for (let i = 1; i < BUCKETS.length; i++) float[i] = each;
  } else if (tailTotal > 0) {
    let p = r;
    for (let i = 1; i < BUCKETS.length; i++) {
      float[i] = W * p;
      p *= r;
    }
  }

  // Largest-remainder rounding so integer counts sum exactly to expected.
  const integers = quantizePreservingSum(float, expected);

  // Locked invariant: bucket[0] should remain == targetWeekly when feasible.
  // The largest-remainder pass might shift ±1 around it; nudge back.
  const desiredFirst = Math.min(W, expected);
  const drift = integers[0] - desiredFirst;
  if (drift !== 0) {
    integers[0] = desiredFirst;
    // Distribute the drift across the tail buckets in proportion to their
    // current value; if drift is positive the tail gains, otherwise loses.
    const tailFloor = (val: number) => Math.max(0, val);
    const sumTail = integers.slice(1).reduce((a, b) => a + b, 0);
    if (sumTail > 0) {
      const adjust = drift; // gained from bucket 0 (positive) or owed (negative)
      // Largest-remainder again on the tail-only adjustment
      const desiredTail = integers
        .slice(1)
        .map((n) => tailFloor(n + (n / sumTail) * adjust));
      const desiredTotal = desiredTail.reduce((a, b) => a + b, 0);
      const correction = desiredTotal - sumTail;
      if (correction !== 0 && desiredTail.length > 0) {
        // Nudge the largest tail bucket
        let maxIdx = 0;
        for (let i = 1; i < desiredTail.length; i++) {
          if (desiredTail[i] > desiredTail[maxIdx]) maxIdx = i;
        }
        desiredTail[maxIdx] -= correction;
      }
      for (let i = 1; i < BUCKETS.length; i++) {
        integers[i] = Math.max(0, Math.round(desiredTail[i - 1]));
      }
    }
  }

  // Ensure the integer total still equals expected (round-trip guard).
  const actualTotal = integers.reduce((a, b) => a + b, 0);
  if (actualTotal !== expected) {
    const diff = expected - actualTotal;
    // Nudge the largest tail bucket to absorb the difference.
    let idx = 1;
    for (let i = 2; i < integers.length; i++) {
      if (integers[i] > integers[idx]) idx = i;
    }
    integers[idx] += diff;
    if (integers[idx] < 0) integers[idx] = 0;
  }

  const total = integers.reduce((a, b) => a + b, 0);
  const impliedWeekly = integers.reduce(
    (s, n, i) => s + (n * BUCKETS[i].visitsPerYear) / 52,
    0,
  );

  return {
    buckets: BUCKETS.map((b, i) => ({
      label: b.label,
      visitsPerYear: b.visitsPerYear,
      people: integers[i],
      pct: total > 0 ? integers[i] / total : 0,
    })),
    impliedWeekly: Math.round(impliedWeekly),
    targetWeekly: weekly,
    expected,
    decayRatio: r,
  };
}

function quantizePreservingSum(values: number[], total: number): number[] {
  const floors = values.map((v) => Math.floor(v));
  const used = floors.reduce((a, b) => a + b, 0);
  let remainder = Math.round(total) - used;
  const indexed = values.map((v, i) => ({ i, frac: v - Math.floor(v) }));
  indexed.sort((a, b) => b.frac - a.frac);
  const out = floors.slice();
  for (const { i } of indexed) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}
