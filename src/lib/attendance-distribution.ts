import "server-only";

/**
 * Simulate a plausible distribution of personal attendance frequencies
 * given a population of N expected attenders and a measured weekly
 * average attendance W.
 *
 * Approach:
 *   1) 8 buckets from "Once a year" (1 visit/yr) up to "Every week" (52).
 *   2) Log-normal weights — real church attendance is heavy-tailed in
 *      log space (lots of regulars, long tail of irregulars), and a
 *      log-normal in visits-per-year matches that shape better than a
 *      Gaussian in linear space.
 *   3) Binary-search the log-normal MEAN until the implied weekly
 *      attendance exactly matches the target. The shape is naturally
 *      skewed left or right depending on whether weekly is high or
 *      low relative to expected — that's the "skewed so it balances".
 *   4) Quantize to whole people preserving the population total, then
 *      one final small-step pass to nudge the integer weekly attendance
 *      back to within 0.5 of target.
 */

export interface FrequencyBucket {
  label: string;
  visitsPerYear: number;
  people: number;
  pct: number;
  weeklyContribution: number;
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

const SIGMA = 0.95; // log-space spread

export interface DistributionResult {
  buckets: FrequencyBucket[];
  predictedWeekly: number;
  targetWeekly: number;
  expected: number;
  meanVisitsPerYear: number;
}

export function buildAttendanceDistribution(
  expected: number,
  weekly: number,
): DistributionResult | null {
  if (expected <= 0 || !weekly || weekly <= 0) return null;
  const target = Math.min(weekly, expected); // sanity cap
  const targetMeanVisits = 52 * (target / expected);

  // Continuous predicted weekly given log-mean μ.
  function predict(lnMu: number): { allocation: number[]; sumWeekly: number } {
    const weights = BUCKETS.map((b) =>
      Math.exp(
        -Math.pow(Math.log(b.visitsPerYear) - lnMu, 2) / (2 * SIGMA * SIGMA),
      ),
    );
    const wSum = weights.reduce((a, b) => a + b, 0);
    const allocation = weights.map((w) => (expected * w) / wSum);
    const sumWeekly = allocation.reduce(
      (s, n, i) => s + (n * BUCKETS[i].visitsPerYear) / 52,
      0,
    );
    return { allocation, sumWeekly };
  }

  // Binary search for the lnMu where predict.sumWeekly == target.
  // sumWeekly is monotonic in lnMu — higher μ → more frequent attenders →
  // higher sumWeekly. So we can binary search.
  let lo = Math.log(0.5);
  let hi = Math.log(60);
  let best = predict((lo + hi) / 2);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const r = predict(mid);
    if (Math.abs(r.sumWeekly - target) < 0.5) {
      best = r;
      break;
    }
    if (r.sumWeekly > target) hi = mid;
    else lo = mid;
    best = r;
  }

  // Quantize to integers preserving the population sum.
  const people = quantizePreservingSum(best.allocation, expected);

  // Final small-step balance: rounding can shift weekly by a couple.
  for (let iter = 0; iter < 200; iter++) {
    const sumW = sumWeekly(people);
    const err = target - sumW;
    if (Math.abs(err) < 0.5) break;
    if (err < 0) {
      // Shift one person from a high-frequency bucket to the lowest bucket.
      let moved = false;
      for (let i = 0; i < BUCKETS.length - 1; i++) {
        if (people[i] >= 1) {
          people[i]--;
          people[BUCKETS.length - 1]++;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    } else {
      let moved = false;
      for (let i = BUCKETS.length - 1; i > 0; i--) {
        if (people[i] >= 1) {
          people[i]--;
          people[0]++;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }

  const total = people.reduce((a, b) => a + b, 0);
  return {
    buckets: BUCKETS.map((b, i) => ({
      label: b.label,
      visitsPerYear: b.visitsPerYear,
      people: people[i],
      pct: total > 0 ? people[i] / total : 0,
      weeklyContribution: (people[i] * b.visitsPerYear) / 52,
    })),
    predictedWeekly: Math.round(sumWeekly(people)),
    targetWeekly: weekly,
    expected,
    meanVisitsPerYear: targetMeanVisits,
  };
}

function sumWeekly(people: number[]): number {
  return people.reduce(
    (s, n, i) => s + (n * BUCKETS[i].visitsPerYear) / 52,
    0,
  );
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
