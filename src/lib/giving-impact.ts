import "server-only";
import { getDb } from "./db";
import { sundayOf, upliftFor } from "./sermon-impact";
import { gatherAnnouncementText, detectAnnouncements, type PlanItemLike } from "./plan-announcements";
import { NEXT_STEPS_CATALOG } from "./next-steps-catalog";
import {
  SOURCE_SCHEDULED,
  SOURCE_LAGGING,
  STATUS_PROCESSING,
  respondingSourceSql,
  payerKeySql,
  giftWeekSql,
} from "./giving-sql";

// ---------------------------------------------------------------------------
// GIVING IMPACT — did giving move after we said something about it?
//
// WHAT THIS PAGE MAY NEVER DO. The PushPay Transactions export carries no
// amount. Not a total, not an average, not a band. Every number produced here
// is a COUNT — of gifts, of people, of Sundays — or a date. Nothing in this
// file, and nothing on the page it feeds, may be phrased or drawn as money.
//
// THE METHOD IS BORROWED, DELIBERATELY. The comparison is the one
// [sermon-impact.ts] already makes and [announcement-impact.ts] already reuses:
// take the weeks after a marked Sunday, total them, and divide by the MEDIAN
// total of the same-length blocks in the surrounding ~year — the LOCAL
// SEASONAL NORM — then take the MEDIAN of those ratios across Sundays. Median
// of ratios, never mean of ratios, and never a ratio of means. `upliftFor` is
// imported and called, not re-implemented, so the headline reading on this
// page is literally the same function the other two pages print.
//
// ONE ADDITION, AND WHY. `upliftFor`'s response window is weeks 1-5 AFTER the
// Sunday. That fits a group application or a first-time serve, which take a
// week to happen. It does not fit giving: the plate goes round the same
// morning, so a gift responding to a Sunday is most likely dated that Sunday —
// inside week 0, which weeks 1-5 skips entirely. `upliftOverWeeks` below is
// the same arithmetic over an arbitrary set of week offsets, and for
// offsets [1,2,3,4,5] it reproduces `upliftFor` exactly (checked pair by pair
// against the imported function over every series and Sunday in the window:
// 180 pairs, 0 differences). BOTH readings are always printed, for every
// overlay, so neither can be the one that happened to look better.
//
// THREE KINDS OF GIFT, NEVER ADDED TOGETHER. See [giving-sql.ts]: responding
// (Web/Text/Mobile/Kiosk) is the only line that can answer a Sunday; Recurring
// is scheduled in advance and rides along as the CONTROL — if it moves as much
// as the responding line, the week moved, not the ask; Batch Entry is keyed in
// by hand afterwards and its date is the typist's, not the giver's.
//
// WHERE n IS TOO SMALL WE SAY SO. Under MIN_N marked Sundays with a usable
// reading, no percentage is produced at all — `enough` is false and the page
// prints the counts and the reason. Between MIN_N and LEAD_N the number is
// printed as a lead, not a finding. Both thresholds are the ones
// announcement-impact already uses, for the same reason.
// ---------------------------------------------------------------------------

/** Fewer marked Sundays than this on either side and we refuse to divide. */
const MIN_N = 5;
/** Below this, a contrast is a lead worth watching, not a finding. */
const LEAD_N = 8;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── the weekly series ──────────────────────────────────────────────────────

interface Series {
  byWeek: Map<string, number>;
  minWk: string | null;
  maxWk: string | null;
}

/** Mean weekly value over a set of Sunday-weeks, skipping weeks outside the
 *  series' coverage. Identical to `windowStats` in [sermon-impact.ts]. */
function windowStats(s: Series, weeks: string[]): { mean: number | null; covered: number } {
  if (!s.minWk || !s.maxWk) return { mean: null, covered: 0 };
  let sum = 0;
  let n = 0;
  for (const wk of weeks) {
    if (wk < s.minWk || wk > s.maxWk) continue;
    sum += s.byWeek.get(wk) ?? 0;
    n++;
  }
  return n > 0 ? { mean: sum / n, covered: n } : { mean: null, covered: 0 };
}

/** `upliftFor` generalised to any response window. `offsets` are week offsets
 *  from the Sunday; the baseline blocks are the same length, drawn from the
 *  surrounding ~year, and every block that would overlap the response window
 *  is dropped so a Sunday can never help build its own norm. With
 *  offsets [1,2,3,4,5] this is `upliftFor`, block for block — which is why the
 *  five-week reading on this page calls the imported one instead. */
function upliftOverWeeks(s: Series, sunday: string, offsets: number[]): number | null {
  const len = offsets.length;
  const lo = Math.min(...offsets);
  const hi = Math.max(...offsets);
  // A 5-week window tolerates 2 missing weeks (sermon-impact's rule); a
  // 1-week window has nothing to tolerate.
  const needPost = len >= 5 ? 3 : len;
  const needBlock = len >= 5 ? 4 : len;
  const post = windowStats(s, offsets.map((k) => addDays(sunday, 7 * k)));
  if (post.mean == null || post.covered < needPost) return null;
  const postTotal = post.mean * len;

  const blocks: number[] = [];
  for (let start = -26; start <= 27; start++) {
    if (!(start + len - 1 < lo || start > hi)) continue; // would overlap the response
    const w = windowStats(
      s,
      Array.from({ length: len }, (_, i) => addDays(sunday, 7 * (start + i))),
    );
    if (w.mean == null || w.covered < needBlock) continue;
    blocks.push(w.mean * len);
  }
  if (blocks.length < 6) return null;
  const expected = median(blocks);
  if (expected == null || expected < 3) return null;
  return postTotal / expected - 1;
}

export interface GivingWeek {
  /** Sunday that starts the week. */
  sunday: string;
  respondingGifts: number;
  respondingGivers: number;
  recurringGifts: number;
  batchGifts: number;
  totalGifts: number;
  /** Gifts in this week still marked Processing — all of them land in the last
   *  weeks of the window, which is why Status is not filtered. */
  processingGifts: number;
  /** False for the first and last week when the export covers only part of
   *  them. Partial weeks are drawn on the chart and excluded from every norm. */
  complete: boolean;
  /** Markers. */
  sermonCalledGiving: boolean;
  planHadGivingItem: boolean;
  brewBreak: boolean;
}

interface WeekRow {
  wk: string;
  responding: number;
  responders: number;
  recurring: number;
  batch: number;
  total: number;
  processing: number;
}

function weeklyRows(orgId: number): WeekRow[] {
  const wk = giftWeekSql("received_on");
  const resp = respondingSourceSql();
  const payer = payerKeySql();
  return getDb()
    .prepare(
      `SELECT ${wk} AS wk,
              SUM(CASE WHEN ${resp} THEN 1 ELSE 0 END) AS responding,
              COUNT(DISTINCT CASE WHEN ${resp} THEN ${payer} END) AS responders,
              SUM(CASE WHEN source = ? THEN 1 ELSE 0 END) AS recurring,
              SUM(CASE WHEN source = ? THEN 1 ELSE 0 END) AS batch,
              COUNT(*) AS total,
              SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS processing
         FROM pushpay_transactions
        WHERE org_id = ?
        GROUP BY wk
        ORDER BY wk`,
    )
    .all(SOURCE_SCHEDULED, SOURCE_LAGGING, STATUS_PROCESSING, orgId) as WeekRow[];
}

// ─── overlays ───────────────────────────────────────────────────────────────

export type MetricRole = "responding" | "scheduled" | "lagging";

export interface Reading {
  /** "the Sunday and the 6 days after" / "the 5 weeks after". */
  windowLabel: string;
  nWith: number;
  nWithout: number;
  withMedian: number | null;
  withoutMedian: number | null;
  contrast: number | null;
  /** False when either side is under MIN_N — the page then prints the counts
   *  and the reason instead of a percentage. */
  enough: boolean;
  /** True when we have enough to divide but not enough to conclude. */
  lead: boolean;
}

export interface OverlayMetric {
  key: string;
  label: string;
  role: MetricRole;
  sameWeek: Reading;
  fiveWeek: Reading;
}

export interface Overlay {
  key: string;
  title: string;
  /** What marks a Sunday, in words. */
  what: string;
  /** Sundays inside the complete-week window carrying the mark. */
  markedSundays: number;
  /** Sundays inside the window in the comparison at all. */
  candidateSundays: number;
  metrics: OverlayMetric[];
  verdict: { tone: "up" | "down" | "neutral" | "blocked"; title: string; detail: string };
  /** The marked Sundays, for the page to list. */
  sundays: string[];
}

function reading(
  s: Series,
  withSundays: string[],
  withoutSundays: string[],
  offsets: number[],
  windowLabel: string,
): Reading {
  const a: number[] = [];
  const b: number[] = [];
  for (const d of withSundays) {
    const u = upliftOverWeeks(s, d, offsets);
    if (u != null) a.push(u);
  }
  for (const d of withoutSundays) {
    const u = upliftOverWeeks(s, d, offsets);
    if (u != null) b.push(u);
  }
  const withMedian = median(a);
  const withoutMedian = median(b);
  const enough = a.length >= MIN_N && b.length >= MIN_N;
  return {
    windowLabel,
    nWith: a.length,
    nWithout: b.length,
    withMedian: enough ? withMedian : null,
    withoutMedian: enough ? withoutMedian : null,
    contrast: enough && withMedian != null && withoutMedian != null ? withMedian - withoutMedian : null,
    enough,
    lead: enough && (a.length < LEAD_N || b.length < LEAD_N),
  };
}

/** The five-week reading, taken from the imported `upliftFor` so it is the
 *  same number the sermon and announcement pages print. */
function fiveWeekReading(s: Series, withS: string[], withoutS: string[]): Reading {
  const a: number[] = [];
  const b: number[] = [];
  for (const d of withS) {
    const u = upliftFor(s, d);
    if (u != null) a.push(u);
  }
  for (const d of withoutS) {
    const u = upliftFor(s, d);
    if (u != null) b.push(u);
  }
  const withMedian = median(a);
  const withoutMedian = median(b);
  const enough = a.length >= MIN_N && b.length >= MIN_N;
  return {
    windowLabel: "the 5 weeks after",
    nWith: a.length,
    nWithout: b.length,
    withMedian: enough ? withMedian : null,
    withoutMedian: enough ? withoutMedian : null,
    contrast: enough && withMedian != null && withoutMedian != null ? withMedian - withoutMedian : null,
    enough,
    lead: enough && (a.length < LEAD_N || b.length < LEAD_N),
  };
}

const PTS = (x: number) => (x >= 0 ? "+" : "") + Math.round(x * 100);

function buildOverlay(
  key: string,
  title: string,
  what: string,
  series: Record<string, Series>,
  withS: string[],
  withoutS: string[],
): Overlay {
  const defs: Array<{ key: string; label: string; role: MetricRole }> = [
    { key: "respondingGifts", label: "Responding gifts", role: "responding" },
    { key: "respondingGivers", label: "Distinct givers, responding channels", role: "responding" },
    { key: "recurringGifts", label: "Recurring gifts (control)", role: "scheduled" },
    { key: "batchGifts", label: "Batch Entry gifts (lagging)", role: "lagging" },
  ];
  const metrics: OverlayMetric[] = defs.map((d) => ({
    ...d,
    sameWeek: reading(series[d.key], withS, withoutS, [0], "the Sunday and the 6 days after"),
    fiveWeek: fiveWeekReading(series[d.key], withS, withoutS),
  }));

  const gifts = metrics[0];
  const control = metrics[2];
  let verdict: Overlay["verdict"];
  if (!gifts.sameWeek.enough && !gifts.fiveWeek.enough) {
    verdict = {
      tone: "blocked",
      title: "Not enough Sundays to compare",
      detail:
        `Marked on ${withS.length} Sunday${withS.length === 1 ? "" : "s"} and unmarked on ${withoutS.length}` +
        ` inside the window. A comparison needs at least ${MIN_N} usable readings on each side, so no percentage is` +
        " shown here — a number built on fewer would look like a finding and would not be one.",
    };
  } else {
    const useSame = gifts.sameWeek.enough;
    const c = useSame ? gifts.sameWeek : gifts.fiveWeek;
    const cc = useSame ? control.sameWeek : control.fiveWeek;
    const when = useSame ? "that same week" : "in the 5 weeks after";
    const pts = c.contrast == null ? 0 : Math.round(c.contrast * 100);
    const ctlPts = cc.contrast == null ? null : Math.round(cc.contrast * 100);
    const placebo =
      ctlPts == null
        ? ""
        : ` Recurring gifts were ${PTS(cc.contrast ?? 0)} points higher on those same Sundays too — and a recurring gift was scheduled weeks earlier, so it cannot answer anything said that morning.` +
          (Math.abs(ctlPts) >= Math.abs(pts)
            ? " That is as much as the responding line moved, so this comparison cannot separate the ask from the week it fell in: these Sundays were simply busier ones for giving."
            : " That is less than the responding line moved, so part of the gap survives the check — but not all of it, and what survives rests on the same small n.");
    if (pts >= 4) {
      verdict = {
        tone: "up",
        title: `More responding gifts ${when}`,
        detail:
          `Median ${PTS(c.withMedian ?? 0)}% against the local norm on the ${c.nWith} marked Sundays, against ${PTS(c.withoutMedian ?? 0)}% on the ${c.nWithout} unmarked ones.` +
          (c.lead ? ` With n=${c.nWith} this is a lead to watch, not a finding.` : "") +
          placebo,
      };
    } else if (pts <= -4) {
      verdict = {
        tone: "down",
        title: `Fewer responding gifts ${when}`,
        detail:
          `Median ${PTS(c.withMedian ?? 0)}% against the local norm on the ${c.nWith} marked Sundays, against ${PTS(c.withoutMedian ?? 0)}% on the ${c.nWithout} unmarked ones.` +
          (c.lead ? ` With n=${c.nWith} this is a lead to watch, not a finding.` : "") +
          placebo,
      };
    } else {
      verdict = {
        tone: "neutral",
        title: "About the same either way",
        detail:
          `Responding gifts sat near the local norm whether or not the Sunday was marked (${PTS(c.withMedian ?? 0)}% on ${c.nWith}, ${PTS(c.withoutMedian ?? 0)}% on ${c.nWithout}).` +
          placebo,
      };
    }
  }

  return {
    key,
    title,
    what,
    markedSundays: withS.length,
    candidateSundays: withS.length + withoutS.length,
    metrics,
    verdict,
    sundays: withS,
  };
}

// ─── what was said from the stage ───────────────────────────────────────────

/** Sundays inside the window whose classified sermon called for giving. Read
 *  the same way [sermon-impact.ts] reads it: the stored classifier's `giving`
 *  next step, `called` true. A mention that the classifier scored but did not
 *  call is NOT a call, and is counted separately so the page can say so. */
function sermonSundays(orgId: number): {
  called: Set<string>;
  mentioned: Set<string>;
  classified: Set<string>;
} {
  const rows = getDb()
    .prepare(`SELECT preached_on, next_steps FROM sermons WHERE org_id = ? AND next_steps IS NOT NULL`)
    .all(orgId) as Array<{ preached_on: string; next_steps: string }>;
  const called = new Set<string>();
  const mentioned = new Set<string>();
  const classified = new Set<string>();
  for (const r of rows) {
    const wk = sundayOf(r.preached_on);
    classified.add(wk);
    let ns: Record<string, { called?: boolean; intensity?: number }> = {};
    try {
      ns = JSON.parse(r.next_steps);
    } catch {
      continue;
    }
    const g = ns.giving;
    if (g?.called) called.add(wk);
    else if ((g?.intensity ?? 0) > 0) mentioned.add(wk);
  }
  for (const wk of called) mentioned.delete(wk);
  return { called, mentioned, classified };
}

const GIVE_STEPS = NEXT_STEPS_CATALOG.filter((s) => s.category === "give");
const GIVE_KEYS = new Set(GIVE_STEPS.map((s) => s.key));
/** The same keyword set, flattened, for matching a single line of text. */
const GIVE_PATTERNS = GIVE_STEPS.flatMap((s) => s.patterns);

interface PlanItemRow extends PlanItemLike {
  plan_id: string;
  sort_date: string | null;
}

/** Sundays whose order of service carried a giving / offering / generosity
 *  item, detected with the same catalog the Announcement impact page uses. */
function planSundays(orgId: number, fromDate: string, toDateExclusive: string): {
  withGiving: Set<string>;
  all: Set<string>;
  /** Orders of service carrying a giving item, per Sunday — two services on a
   *  Sunday are two plans, so this is larger than the Sunday count. */
  plansByWeek: Map<string, number>;
} {
  const rows = getDb()
    .prepare(
      `SELECT pi.plan_id, pl.sort_date, pi.item_type, pi.title, pi.description, pi.html_details
         FROM pco_plan_items pi
         JOIN pco_plans pl ON pl.org_id = pi.org_id AND pl.pco_id = pi.plan_id
        WHERE pi.org_id = ? AND pl.sort_date >= ? AND pl.sort_date < ?
        ORDER BY pi.plan_id, pi.sequence`,
    )
    .all(orgId, fromDate, toDateExclusive) as PlanItemRow[];
  const byPlan = new Map<string, { sortDate: string | null; items: PlanItemRow[] }>();
  for (const r of rows) {
    let e = byPlan.get(r.plan_id);
    if (!e) {
      e = { sortDate: r.sort_date, items: [] };
      byPlan.set(r.plan_id, e);
    }
    e.items.push(r);
  }
  const withGiving = new Set<string>();
  const all = new Set<string>();
  const plansByWeek = new Map<string, number>();
  for (const { sortDate, items: its } of byPlan.values()) {
    if (!sortDate) continue;
    const wk = sundayOf(sortDate);
    all.add(wk);
    const hits = detectAnnouncements(gatherAnnouncementText(its)).filter((d) => GIVE_KEYS.has(d.key));
    if (hits.length) {
      withGiving.add(wk);
      plansByWeek.set(wk, (plansByWeek.get(wk) ?? 0) + 1);
    }
  }
  return { withGiving, all, plansByWeek };
}

// ─── Brew Break ─────────────────────────────────────────────────────────────

export interface BrewBreakSunday {
  sunday: string;
  /** Distinct people checked in that Sunday. */
  checkedIn: number | null;
  /** Gifts dated that Sunday itself, responding channels. */
  respondingGifts: number;
  per100: number | null;
}

export interface BrewBreak {
  /** Plan items naming it, and the Sundays they sit on — searched over the
   *  WHOLE synced history of the orders of service, not just the gift window,
   *  so `sundays[0]` is the first time it was ever on a plan. */
  items: number;
  sundays: string[];
  /** The one line of an order of service that names Brew Break and giving in
   *  the same breath, verbatim — the only place the data connects the two.
   *  A single line, capped, never a whole item. */
  givingLine: { sunday: string; text: string } | null;
  /** The one complete gift week after it started. */
  week: string | null;
  weekRespondingGifts: number | null;
  weekRespondingGivers: number | null;
  weekProcessingGifts: number | null;
  /** Of those, the ones on a responding channel — the subset the settled-only
   *  reading actually drops. */
  weekProcessingResponding: number | null;
  /** That week against the local norm, every gift row counted. */
  upliftAllRows: number | null;
  /** The same reading with the still-clearing gifts dropped — shown because
   *  the answer changes sign, which is the point. */
  upliftSettledOnly: number | null;
  /** Gifts per 100 people checked in, the Brew Break Sunday and its
   *  neighbours, against the median Sunday of the window. */
  recent: BrewBreakSunday[];
  per100Median: number | null;
  per100N: number;
  /** The Brew Break Sunday's own gifts per 100 checked in, and where it sits
   *  against `per100Median`. MEASURED, not asserted: the page prints "above",
   *  "below" or "inside the ordinary scatter" from `per100Verdict`, because on
   *  today's export the Sunday is 13.6 against a median of 13.1 and on the
   *  next one it will not be.
   *
   *  `near` means within one MEDIAN ABSOLUTE DEVIATION of the median — the
   *  spread measured off these same Sundays rather than a round number picked
   *  to suit them, so it moves with the data. Today that is 2.34 gifts per 100
   *  against a gap of 0.50: the Brew Break Sunday is about a fifth as far from
   *  the middle as a typical Sunday is, which is not a difference. `per100Mad`
   *  is published so the threshold can be checked rather than believed. */
  per100Brew: number | null;
  per100Mad: number | null;
  per100Verdict: "above" | "below" | "near" | null;
  /** Biggest responding week of the window, and when. */
  peakWeek: string | null;
  peakWeekGifts: number | null;
  /** True only when the peak week is the week IMMEDIATELY before Brew Break.
   *  "Before" and "the week before" are different claims and the copy makes
   *  the stronger one only when this says it can. */
  peakWeekIsWeekBefore: boolean;
  /** How far check-in reaches: the median ratio of people checked in to people
   *  counted in the room on Sundays where both numbers exist. */
  checkinCoverage: number | null;
  checkinCoverageN: number;
}

// ─── announcers ─────────────────────────────────────────────────────────────

export interface AnnouncerSunday {
  sunday: string;
  names: string[];
  respondingGifts: number | null;
  respondingGivers: number | null;
  checkedIn: number | null;
  complete: boolean;
}

export interface AnnouncerPerson {
  personId: string;
  name: string;
  sundays: string[];
  /** Responding gifts in each of that person's weeks, in date order. Shown as
   *  the spread rather than an average on purpose — see the page copy. */
  weekGifts: Array<number | null>;
}

// ─── the summary ────────────────────────────────────────────────────────────

export interface SourceMix {
  source: string;
  role: MetricRole;
  gifts: number;
  payers: number;
}

export interface GivingImpactSummary {
  hasGifts: boolean;
  firstGiftOn: string | null;
  lastGiftOn: string | null;
  gifts: number;
  payers: number;
  /** Complete-week span the comparisons run over. */
  firstWeek: string | null;
  lastWeek: string | null;
  completeWeeks: number;
  giftsPerWeek: number | null;
  partialWeeks: string[];
  processingGifts: number;
  /** Weeks carrying at least one gift that has not settled yet. Derived, not
   *  asserted: the page says where they are rather than claiming they are
   *  always at the end. */
  processingWeeks: string[];
  weeks: GivingWeek[];
  sources: SourceMix[];
  overlays: Overlay[];
  brewBreak: BrewBreak;
  announcerSundays: AnnouncerSunday[];
  announcers: AnnouncerPerson[];
  /** Sermons: how many the classifier read inside the window, how many called
   *  for giving, how many only mentioned it. */
  sermonsClassified: number;
  sermonsCalled: number;
  sermonsMentioned: number;
  /** Plans: Sundays with an order of service, how many carried a giving item,
   *  and how many orders of service that was (two services = two plans). */
  planSundays: number;
  planSundaysWithGiving: number;
  planGivingPlans: number;
}

const EASTERN_DATE = `CASE WHEN date(c.event_time_starts_at) >= date(strftime('%Y', c.event_time_starts_at) || '-03-08', 'weekday 0')
        AND date(c.event_time_starts_at) <  date(strftime('%Y', c.event_time_starts_at) || '-11-01', 'weekday 0')
       THEN date(c.event_time_starts_at, '-4 hours') ELSE date(c.event_time_starts_at, '-5 hours') END`;

export function computeGivingImpact(orgId: number): GivingImpactSummary {
  const db = getDb();
  const snap = db
    .prepare(
      `SELECT first_gift_on, last_gift_on, gifts, payers FROM pushpay_giving_snapshot WHERE org_id = ?`,
    )
    .get(orgId) as
    | { first_gift_on: string | null; last_gift_on: string | null; gifts: number; payers: number }
    | undefined;

  const rows = weeklyRows(orgId);
  const empty: GivingImpactSummary = {
    hasGifts: false,
    firstGiftOn: snap?.first_gift_on ?? null,
    lastGiftOn: snap?.last_gift_on ?? null,
    gifts: snap?.gifts ?? 0,
    payers: snap?.payers ?? 0,
    firstWeek: null,
    lastWeek: null,
    completeWeeks: 0,
    giftsPerWeek: null,
    partialWeeks: [],
    processingGifts: 0,
    processingWeeks: [],
    weeks: [],
    sources: [],
    overlays: [],
    brewBreak: {
      items: 0,
      sundays: [],
      givingLine: null,
      week: null,
      weekRespondingGifts: null,
      weekRespondingGivers: null,
      weekProcessingGifts: null,
      weekProcessingResponding: null,
      upliftAllRows: null,
      upliftSettledOnly: null,
      recent: [],
      per100Median: null,
      per100N: 0,
      per100Brew: null,
      per100Mad: null,
      per100Verdict: null,
      peakWeek: null,
      peakWeekGifts: null,
      peakWeekIsWeekBefore: false,
      checkinCoverage: null,
      checkinCoverageN: 0,
    },
    announcerSundays: [],
    announcers: [],
    sermonsClassified: 0,
    sermonsCalled: 0,
    sermonsMentioned: 0,
    planSundays: 0,
    planSundaysWithGiving: 0,
    planGivingPlans: 0,
  };
  if (!rows.length || !snap?.first_gift_on || !snap.last_gift_on) return empty;

  const first = snap.first_gift_on;
  const last = snap.last_gift_on;
  // A week counts only when the export covers all seven of its days. The first
  // and last weeks of any import are otherwise read as quiet weeks and drag
  // every norm they touch.
  const firstWk = sundayOf(first);
  const firstComplete = firstWk === first ? firstWk : addDays(firstWk, 7);
  const lastWk = sundayOf(last);
  const lastComplete = addDays(lastWk, 6) <= last ? lastWk : addDays(lastWk, -7);
  const complete = (wk: string) => wk >= firstComplete && wk <= lastComplete;

  const mk = (pick: (r: WeekRow) => number): Series => {
    const byWeek = new Map<string, number>();
    for (const r of rows) if (complete(r.wk)) byWeek.set(r.wk, pick(r));
    return { byWeek, minWk: firstComplete, maxWk: lastComplete };
  };
  const series: Record<string, Series> = {
    respondingGifts: mk((r) => r.responding),
    respondingGivers: mk((r) => r.responders),
    recurringGifts: mk((r) => r.recurring),
    batchGifts: mk((r) => r.batch),
  };

  const sermons = sermonSundays(orgId);
  // Bounded to the weeks the comparisons can use. Everything outside them is
  // dropped by `windowWeeks` anyway, and the unbounded scan reads 18,652 plan
  // items through the whole keyword catalog to reach 1,474 that matter.
  const plans = planSundays(orgId, firstComplete, addDays(lastComplete, 7));

  // Brew Break: the plan items that name it, anywhere in the synced history.
  const brewRows = db
    .prepare(
      `SELECT pl.sort_date AS sortDate,
              COALESCE(pi.description, '') || ' ' || COALESCE(pi.title, '') AS text
         FROM pco_plan_items pi
         JOIN pco_plans pl ON pl.org_id = pi.org_id AND pl.pco_id = pi.plan_id
        WHERE pi.org_id = ?
          AND (lower(COALESCE(pi.title, '')) LIKE '%brew break%'
            OR lower(COALESCE(pi.description, '')) LIKE '%brew break%'
            OR lower(COALESCE(pi.html_details, '')) LIKE '%brew break%')
        ORDER BY pl.sort_date`,
    )
    .all(orgId) as Array<{ sortDate: string | null; text: string }>;
  const brewSundays = [...new Set(brewRows.map((r) => (r.sortDate ? sundayOf(r.sortDate) : "")).filter(Boolean))].sort();

  // The one line where the order of service names Brew Break and giving
  // together. Taken a LINE at a time and capped, so a whole item — which can
  // carry a sermon summary and the names of whoever was on — never lands on
  // the page through here.
  let givingLine: { sunday: string; text: string } | null = null;
  for (const r of brewRows) {
    if (!r.sortDate) continue;
    for (const raw of r.text.split(/[\r\n]+/)) {
      const line = raw.trim().replace(/^[-•*\s]+/, "").trim();
      if (line.length === 0 || line.length > 70) continue;
      if (!/brew break/i.test(line)) continue;
      if (!GIVE_PATTERNS.some((re) => re.test(line))) continue;
      givingLine = { sunday: sundayOf(r.sortDate), text: line };
      break;
    }
    if (givingLine) break;
  }

  const weeks: GivingWeek[] = rows.map((r) => ({
    sunday: r.wk,
    respondingGifts: r.responding,
    respondingGivers: r.responders,
    recurringGifts: r.recurring,
    batchGifts: r.batch,
    totalGifts: r.total,
    processingGifts: r.processing,
    complete: complete(r.wk),
    sermonCalledGiving: sermons.called.has(r.wk),
    planHadGivingItem: plans.withGiving.has(r.wk),
    brewBreak: brewSundays.includes(r.wk),
  }));

  const windowWeeks = weeks.filter((w) => w.complete).map((w) => w.sunday);
  const inWindow = (s: Set<string>) => windowWeeks.filter((w) => s.has(w));

  const sermonWindow = windowWeeks.filter((w) => sermons.classified.has(w));
  const sermonCalled = sermonWindow.filter((w) => sermons.called.has(w));
  const sermonNot = sermonWindow.filter((w) => !sermons.called.has(w));

  const planWindow = windowWeeks.filter((w) => plans.all.has(w));
  const planWith = planWindow.filter((w) => plans.withGiving.has(w));
  const planWithout = planWindow.filter((w) => !plans.withGiving.has(w));

  const overlays: Overlay[] = [
    buildOverlay(
      "sermon",
      "Sundays the sermon called for giving",
      "The Sermon Lab classifier read every transcript and recorded whether the message asked people to give. Only a recorded CALL counts here — a passing mention does not.",
      series,
      sermonCalled,
      sermonNot,
    ),
    buildOverlay(
      "plan",
      "Sundays with a giving or offering item in the plan",
      "The order of service, read with the same keyword catalog the Announcement impact page uses: giving, offering, generosity, tithe, stewardship.",
      series,
      planWith,
      planWithout,
    ),
  ];

  // ── Brew Break arithmetic ────────────────────────────────────────────────
  const brewStart = brewSundays.find((d) => complete(d)) ?? null;
  const brewWeekRow = brewStart ? rows.find((r) => r.wk === brewStart) ?? null : null;

  // The same week, counting only gifts that have settled. Kept apart from the
  // main series because it is a DIFFERENT question, and the answer differs.
  const settledRows = db
    .prepare(
      `SELECT ${giftWeekSql("received_on")} AS wk,
              SUM(CASE WHEN ${respondingSourceSql()} THEN 1 ELSE 0 END) AS responding
         FROM pushpay_transactions
        WHERE org_id = ? AND status <> ?
        GROUP BY wk`,
    )
    .all(orgId, STATUS_PROCESSING) as Array<{ wk: string; responding: number }>;
  const settledSeries: Series = {
    byWeek: new Map(settledRows.filter((r) => complete(r.wk)).map((r) => [r.wk, r.responding])),
    minWk: firstComplete,
    maxWk: lastComplete,
  };

  // Sunday-level: gifts dated the Sunday itself against people checked in.
  const sundayGifts = new Map(
    (
      db
        .prepare(
          `SELECT received_on AS d, SUM(CASE WHEN ${respondingSourceSql()} THEN 1 ELSE 0 END) AS responding
             FROM pushpay_transactions WHERE org_id = ? GROUP BY d`,
        )
        .all(orgId) as Array<{ d: string; responding: number }>
    ).map((r) => [r.d, r.responding]),
  );
  const checkedIn = new Map(
    (
      db
        .prepare(
          // Bounded, because this table holds 276k rows and the unbounded
          // scan is 0.5 s on its own — nine tenths of the page's query time.
          // The bounds are generous by a day at each end: the column is true
          // UTC and the church's date is 4-5 hours behind it, so an Eastern
          // date can sit either side of a UTC midnight.
          `SELECT ${EASTERN_DATE} AS d, COUNT(DISTINCT c.person_id) AS people
             FROM pco_check_ins c
            WHERE c.org_id = ? AND c.person_id IS NOT NULL
              AND c.event_time_starts_at >= ? AND c.event_time_starts_at < ?
            GROUP BY d`,
        )
        .all(orgId, firstComplete, addDays(lastComplete, 8)) as Array<{ d: string; people: number }>
    ).map((r) => [r.d, r.people]),
  );

  const per100All: number[] = [];
  for (const wk of windowWeeks) {
    const ci = checkedIn.get(wk);
    const g = sundayGifts.get(wk) ?? 0;
    if (ci && ci > 0) per100All.push((g / ci) * 100);
  }
  const brewRecent: BrewBreakSunday[] = windowWeeks.slice(-7).map((wk) => {
    const ci = checkedIn.get(wk) ?? null;
    const g = sundayGifts.get(wk) ?? 0;
    return { sunday: wk, checkedIn: ci, respondingGifts: g, per100: ci && ci > 0 ? (g / ci) * 100 : null };
  });

  let peakWeek: string | null = null;
  let peakGifts = -1;
  for (const w of weeks) {
    if (w.complete && w.respondingGifts > peakGifts) {
      peakGifts = w.respondingGifts;
      peakWeek = w.sunday;
    }
  }

  // How much of the room check-in actually sees. Only Sundays where the
  // attendance sheet also has a count can answer it.
  const coverage = (
    db
      .prepare(
        `SELECT a.sunday_on AS d, a.in_person_total AS present
           FROM attendance_weekly a
          WHERE a.org_id = ? AND a.in_person_total IS NOT NULL AND a.in_person_total > 0
            AND a.sunday_on >= ?`,
      )
      .all(orgId, firstComplete) as Array<{ d: string; present: number }>
  )
    .map((r) => {
      const ci = checkedIn.get(r.d);
      return ci ? ci / r.present : null;
    })
    .filter((x): x is number => x != null);

  // How the Brew Break Sunday reads against a typical one, and whether the
  // window's biggest week really is the week BEFORE it. Both were prose once,
  // true of this export and of no other; they are measured here so the
  // sentences on the page cannot outlive the numbers printed beside them.
  const per100MedianVal = median(per100All);
  const per100Brew =
    brewStart == null ? null : (brewRecent.find((r) => r.sunday === brewStart)?.per100 ?? null);
  // Spread read off the same Sundays: the median distance from the median.
  // A threshold measured this way follows the data instead of being a round
  // number that happens to sit either side of this export's answer.
  const per100Mad =
    per100MedianVal == null ? null : median(per100All.map((x) => Math.abs(x - per100MedianVal)));
  const per100Verdict: BrewBreak["per100Verdict"] =
    per100Brew == null || per100MedianVal == null
      ? null
      : per100Mad != null && Math.abs(per100Brew - per100MedianVal) <= per100Mad
        ? "near"
        : per100Brew > per100MedianVal
          ? "above"
          : "below";

  const brewBreak: BrewBreak = {
    items: brewRows.length,
    sundays: brewSundays,
    givingLine,
    week: brewStart,
    weekRespondingGifts: brewWeekRow?.responding ?? null,
    weekRespondingGivers: brewWeekRow?.responders ?? null,
    weekProcessingGifts: brewWeekRow?.processing ?? null,
    weekProcessingResponding:
      brewStart == null
        ? null
        : (series.respondingGifts.byWeek.get(brewStart) ?? 0) - (settledSeries.byWeek.get(brewStart) ?? 0),
    upliftAllRows: brewStart ? upliftOverWeeks(series.respondingGifts, brewStart, [0]) : null,
    upliftSettledOnly: brewStart ? upliftOverWeeks(settledSeries, brewStart, [0]) : null,
    recent: brewRecent,
    per100Median: per100MedianVal,
    per100N: per100All.length,
    per100Brew,
    per100Mad,
    per100Verdict,
    peakWeek,
    peakWeekGifts: peakGifts >= 0 ? peakGifts : null,
    peakWeekIsWeekBefore: brewStart != null && peakWeek != null && peakWeek === addDays(brewStart, -7),
    checkinCoverage: median(coverage),
    checkinCoverageN: coverage.length,
  };

  // ── announcers ───────────────────────────────────────────────────────────
  const annRows = db
    .prepare(
      `SELECT pl.sort_date AS sortDate, pp.person_id AS personId,
              p.first_name AS firstName, p.nickname AS nickname, p.last_name AS lastName
         FROM pco_plan_people pp
         JOIN pco_plans pl ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
         LEFT JOIN pco_people p ON p.org_id = pp.org_id AND p.pco_id = pp.person_id
        WHERE pp.org_id = ? AND pp.team_position_name = 'Announcements'
          AND lower(COALESCE(pp.status, 'c')) NOT IN ('d', 'declined')
          AND pl.sort_date IS NOT NULL AND pl.sort_date <> ''
        ORDER BY pl.sort_date`,
    )
    .all(orgId) as Array<{
    sortDate: string;
    personId: string;
    firstName: string | null;
    nickname: string | null;
    lastName: string | null;
  }>;

  const weekBySunday = new Map(weeks.map((w) => [w.sunday, w]));
  const bySunday = new Map<string, Map<string, string>>();
  const byPerson = new Map<string, { name: string; sundays: Set<string> }>();
  for (const r of annRows) {
    const wk = sundayOf(r.sortDate);
    if (!complete(wk)) continue;
    const name = [r.nickname || r.firstName, r.lastName].filter(Boolean).join(" ") || "(unnamed)";
    let m = bySunday.get(wk);
    if (!m) {
      m = new Map();
      bySunday.set(wk, m);
    }
    m.set(r.personId, name);
    let p = byPerson.get(r.personId);
    if (!p) {
      p = { name, sundays: new Set() };
      byPerson.set(r.personId, p);
    }
    p.sundays.add(wk);
  }

  const announcerSundays: AnnouncerSunday[] = [...bySunday.keys()]
    .sort()
    .reverse()
    .map((wk) => {
      const w = weekBySunday.get(wk);
      return {
        sunday: wk,
        names: [...bySunday.get(wk)!.values()].sort((a, b) => a.localeCompare(b)),
        respondingGifts: w?.respondingGifts ?? null,
        respondingGivers: w?.respondingGivers ?? null,
        checkedIn: checkedIn.get(wk) ?? null,
        complete: w?.complete ?? false,
      };
    });

  const announcers: AnnouncerPerson[] = [...byPerson.entries()]
    .map(([personId, p]) => {
      const sundays = [...p.sundays].sort();
      return {
        personId,
        name: p.name,
        sundays,
        weekGifts: sundays.map((wk) => weekBySunday.get(wk)?.respondingGifts ?? null),
      };
    })
    // Alphabetical, deliberately. Sorting these by any number would make a
    // league table out of one to ten Sundays a head.
    .sort((a, b) => a.name.localeCompare(b.name));

  const sources = (
    db
      .prepare(
        `SELECT COALESCE(source, '(none)') AS source, COUNT(*) AS gifts,
                COUNT(DISTINCT ${payerKeySql()}) AS payers
           FROM pushpay_transactions WHERE org_id = ? GROUP BY source ORDER BY gifts DESC`,
      )
      .all(orgId) as Array<{ source: string; gifts: number; payers: number }>
  ).map((r) => ({
    ...r,
    role: (r.source === SOURCE_SCHEDULED
      ? "scheduled"
      : r.source === SOURCE_LAGGING
        ? "lagging"
        : "responding") as MetricRole,
  }));

  const completeRows = rows.filter((r) => complete(r.wk));
  const totalComplete = completeRows.reduce((a, r) => a + r.total, 0);

  return {
    hasGifts: true,
    firstGiftOn: first,
    lastGiftOn: last,
    gifts: snap.gifts,
    payers: snap.payers,
    firstWeek: firstComplete,
    lastWeek: lastComplete,
    completeWeeks: completeRows.length,
    giftsPerWeek: completeRows.length ? totalComplete / completeRows.length : null,
    partialWeeks: weeks.filter((w) => !w.complete).map((w) => w.sunday),
    processingGifts: rows.reduce((a, r) => a + r.processing, 0),
    processingWeeks: rows.filter((r) => r.processing > 0).map((r) => r.wk),
    weeks,
    sources,
    overlays,
    brewBreak,
    announcerSundays,
    announcers,
    sermonsClassified: sermonWindow.length,
    sermonsCalled: sermonCalled.length,
    sermonsMentioned: inWindow(sermons.mentioned).length,
    planSundays: planWindow.length,
    planSundaysWithGiving: planWith.length,
    planGivingPlans: planWith.reduce((a, w) => a + (plans.plansByWeek.get(w) ?? 0), 0),
  };
}
