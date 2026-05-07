import "server-only";

/**
 * Simulate a plausible distribution of personal attendance frequencies
 * given a population of N expected attenders and a measured weekly
 * average attendance W.
 *
 * Approach:
 *   1) 8 buckets from "Once a year" (1 visit/yr) to "Every week" (52 visits/yr).
 *   2) Build a log-normal-shaped population centered on the implied mean
 *      visits/year (= 52 × W/N). Real-world church attendance is heavy-
 *      tailed in log space, so log-normal fits better than a Gaussian
 *      in linear space.
 *   3) Iteratively swap whole-person counts between extreme buckets until
 *      the implied weekly attendance (Σ people_i × visits_i / 52) matches
 *      the observed W. This is the "skew it so it balances" step — a
 *      symmetric bell would over- or under-shoot W; the skew accounts
 *      for that.
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

export interface DistributionResult {
  buckets: FrequencyBucket[];
  /** Weekly attendance the distribution actually produces. */
  predictedWeekly: number;
  /** Weekly attendance the user provided. */
  targetWeekly: number;
  expected: number;
  meanVisitsPerYear: number;
}

export function buildAttendanceDistribution(
  expected: number,
  weekly: number,
): DistributionResult | null {
  if (expected <= 0 || !weekly || weekly <= 0) return null;
  // Cap mean at 52 (every-week ceiling) just in case W > E.
  const cappedWeekly = Math.min(weekly, expected);
  const meanVisits = 52 * (cappedWeekly / expected);

  // Log-normal weights, centered on the implied mean.
  const lnMean = Math.log(Math.max(0.5, meanVisits));
  const sigma = 0.95; // tunable spread
  const weights = BUCKETS.map((b) =>
    Math.exp(-Math.pow(Math.log(b.visitsPerYear) - lnMean, 2) / (2 * sigma * sigma)),
  );
  const wSum = weights.reduce((a, b) => a + b, 0);

  // Initial real-valued allocation that sums to `expected`.
  let alloc = weights.map((w) => (expected * w) / wSum);

  // Snap to integers, preserving the row sum at `expected` via remainders.
  let people = quantizePreservingSum(alloc, expected);

  // Balance pass: swap one person at a time between the highest and lowest
  // buckets until predicted weekly within 0.5 of target. Caps iterations.
  for (let iter = 0; iter < 500; iter++) {
    const predicted = sumWeekly(people);
    const err = cappedWeekly - predicted;
    if (Math.abs(err) < 0.5) break;
    if (err > 0) {
      // Need more frequent attenders — move 1 person up the ladder.
      const fromIdx = lowestNonZeroFrom(people, BUCKETS.length - 1);
      if (fromIdx === -1 || fromIdx === 0) break;
      people[fromIdx] -= 1;
      people[0] += 1;
    } else {
      // Too many regulars — move 1 person down.
      if (people[0] < 1) break;
      people[0] -= 1;
      people[BUCKETS.length - 1] += 1;
    }
  }

  // Build result rows.
  const total = people.reduce((a, b) => a + b, 0);
  const predictedWeekly = sumWeekly(people);
  const buckets: FrequencyBucket[] = BUCKETS.map((b, i) => ({
    label: b.label,
    visitsPerYear: b.visitsPerYear,
    people: people[i],
    pct: total > 0 ? people[i] / total : 0,
    weeklyContribution: (people[i] * b.visitsPerYear) / 52,
  }));
  return {
    buckets,
    predictedWeekly,
    targetWeekly: weekly,
    expected,
    meanVisitsPerYear: meanVisits,
  };
}

function sumWeekly(people: number[]): number {
  return people.reduce(
    (s, n, i) => s + (n * BUCKETS[i].visitsPerYear) / 52,
    0,
  );
}

function lowestNonZeroFrom(people: number[], startIdx: number): number {
  for (let i = startIdx; i >= 1; i--) {
    if (people[i] >= 1) return i;
  }
  return -1;
}

/** Round each value while preserving the total (largest-remainder method). */
function quantizePreservingSum(values: number[], total: number): number[] {
  const floors = values.map((v) => Math.floor(v));
  const used = floors.reduce((a, b) => a + b, 0);
  let remainder = Math.round(total) - used;
  // Sort by fractional part desc, allocate +1 to the largest fractions
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
