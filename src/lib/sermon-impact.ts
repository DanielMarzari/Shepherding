import "server-only";
import { getDb } from "./db";
import type { SeasonalInsight } from "./attendance-seasonal";

// ---------------------------------------------------------------------------
// Sermon impact: does what the pastor PREACHED move measurable congregation
// activity in the weeks that follow? We line each classified sermon (see the
// `sermons` table + sermon-impact classifier) up against six weekly activity
// series and, for the next-step categories we can actually measure, compare
// the uplift after sermons that *called* for that step against sermons that
// didn't. Everything here is congregation-level weekly aggregates — no PII.
// ---------------------------------------------------------------------------

/** The next-step categories the classifier tags on every sermon. `metric` is
 *  the weekly outcome series we correlate the call against, or null when the
 *  church doesn't yet track an outcome for it (notably giving — Shepherdly has
 *  no dated gifts, only last-gift). */
export {
  NEXT_STEPS,
  METRIC_LABELS,
} from "./next-step-types";
export type { MetricKey, NextStepKey, SermonListRow } from "./next-step-types";

import {
  NEXT_STEPS,
  METRIC_LABELS,
  type MetricKey,
  type NextStepKey,
  type SermonListRow,
} from "./next-step-types";

interface NextStepVal {
  called: boolean;
  intensity: number;
  quote: string;
}

export interface SermonRow {
  source_id: number;
  preached_on: string; // 'YYYY-MM-DD'
  title: string | null;
  scripture: string | null;
  speaker: string | null;
  topic: string | null;
  summary: string | null;
  themes: string[];
  next_steps: Record<string, NextStepVal>;
  confidence: number | null;
  classified: boolean;
}

// ---- date helpers (UTC, week starts Sunday to match sermon Sundays) --------

function addDays(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Snap any date/timestamp to the Sunday that starts its week. */
export function sundayOf(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

// ---- weekly metric series --------------------------------------------------

interface MetricSeries {
  byWeek: Map<string, number>;
  minWk: string | null;
  maxWk: string | null;
}

/** Bucket a dated column into Sunday-week counts. The modifier
 *  `-<dow> days` walks any date back to its week's Sunday (dow 0 = Sunday). */
function weeklyCount(sql: string, orgId: number): MetricSeries {
  const rows = getDb().prepare(sql).all(orgId) as Array<{ wk: string; c: number }>;
  const byWeek = new Map<string, number>();
  let minWk: string | null = null;
  let maxWk: string | null = null;
  for (const r of rows) {
    if (!r.wk) continue;
    byWeek.set(r.wk, r.c);
    if (minWk === null || r.wk < minWk) minWk = r.wk;
    if (maxWk === null || r.wk > maxWk) maxWk = r.wk;
  }
  return { byWeek, minWk, maxWk };
}

const WK = (col: string) => `date(${col}, '-' || strftime('%w', ${col}) || ' days')`;

export function getWeeklyMetrics(orgId: number): Record<MetricKey, MetricSeries> {
  return {
    group_apps: weeklyCount(
      `SELECT ${WK("applied_at")} wk, COUNT(*) c FROM pco_group_applications
        WHERE org_id=? AND applied_at IS NOT NULL AND applied_at<>'' GROUP BY wk`,
      orgId,
    ),
    group_joins: weeklyCount(
      `SELECT ${WK("joined_at")} wk, COUNT(*) c FROM pco_group_memberships
        WHERE org_id=? AND joined_at IS NOT NULL AND joined_at<>'' GROUP BY wk`,
      orgId,
    ),
    checkins: weeklyCount(
      `SELECT ${WK("event_time_at")} wk, COUNT(*) c FROM pco_check_ins
        WHERE org_id=? AND event_time_at IS NOT NULL AND event_time_at<>'' GROUP BY wk`,
      orgId,
    ),
    form_subs: weeklyCount(
      `SELECT ${WK("pco_created_at")} wk, COUNT(*) c FROM pco_form_submissions
        WHERE org_id=? AND pco_created_at IS NOT NULL AND pco_created_at<>'' GROUP BY wk`,
      orgId,
    ),
    // First-ever check-in per person = new attenders showing up that week.
    new_attenders: weeklyCount(
      `WITH f AS (
         SELECT person_id, MIN(event_time_at) fa FROM pco_check_ins
          WHERE org_id=? AND person_id IS NOT NULL AND event_time_at IS NOT NULL AND event_time_at<>''
          GROUP BY person_id)
       SELECT ${WK("fa")} wk, COUNT(*) c FROM f GROUP BY wk`,
      orgId,
    ),
    // First-ever serving assignment per person = new servers starting that week.
    new_servers: weeklyCount(
      `WITH f AS (
         SELECT pp.person_id, MIN(pl.sort_date) fs
           FROM pco_plan_people pp
           JOIN pco_plans pl ON pl.org_id=pp.org_id AND pl.pco_id=pp.plan_id
          WHERE pp.org_id=? AND pp.person_id IS NOT NULL
            AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
            AND pl.sort_date IS NOT NULL AND pl.sort_date<>''
          GROUP BY pp.person_id)
       SELECT ${WK("fs")} wk, COUNT(*) c FROM f GROUP BY wk`,
      orgId,
    ),
  };
}

// ---- windows & uplift ------------------------------------------------------

/** Mean of a series over a set of Sunday weeks. Weeks inside the series'
 *  coverage but with no rows count as 0 (a real quiet week); weeks outside
 *  coverage are skipped so we never invent activity before/after the data. */
function windowStats(s: MetricSeries, weeks: string[]): { mean: number | null; covered: number } {
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

const POST_WEEKS = [1, 2, 3, 4, 5];

/** Start offsets (in weeks from the sermon Sunday) of the 5-week baseline
 *  blocks used to estimate the LOCAL seasonal norm: the ~6 months before and
 *  ~6 months after, every block chosen so it never overlaps the 5 response
 *  weeks (offsets 1..5) — so the sermon's own effect can't leak into its own
 *  baseline. */
const BASE_BLOCK_STARTS: number[] = (() => {
  const o: number[] = [];
  for (let s = -26; s <= -4; s++) o.push(s); // blocks ending by offset 0
  for (let s = 6; s <= 27; s++) o.push(s); // blocks starting after the response window
  return o;
})();

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Mean weekly value of a 5-week block starting `start` weeks from the sermon,
 *  scaled to a full 5-week span — or null if the block is too sparse / outside
 *  coverage. */
function blockLevel(s: MetricSeries, sunday: string, start: number): number | null {
  const w = windowStats(s, [0, 1, 2, 3, 4].map((i) => addDays(sunday, 7 * (start + i))));
  if (w.mean == null || w.covered < 4) return null;
  return w.mean * 5;
}

/** How far the 5 weeks after a sermon run above (or below) the LOCAL seasonal
 *  norm, as a fraction (0.06 = +6%). We work in 5-week TOTALS (which is what
 *  "an uptick over the next 4-5 weeks" actually means, and is far less spiky
 *  than weekly counts), comparing the post-window total to the MEDIAN 5-week
 *  total in the surrounding ~year. Median (not mean) baseline keeps campaign
 *  launches and one-off events from distorting the norm; the >=3 floor stops
 *  a near-dead stretch from producing a divide-by-tiny blowup. null when
 *  either side is too sparse. */
export function upliftFor(s: MetricSeries, sunday: string): number | null {
  const post = windowStats(s, POST_WEEKS.map((k) => addDays(sunday, 7 * k)));
  if (post.mean == null || post.covered < 3) return null;
  const post5 = post.mean * 5;
  const blocks: number[] = [];
  for (const st of BASE_BLOCK_STARTS) {
    const b = blockLevel(s, sunday, st);
    if (b != null) blocks.push(b);
  }
  if (blocks.length < 6) return null;
  const expected = median(blocks);
  if (expected == null || expected < 3) return null;
  return post5 / expected - 1;
}

// ---- reading sermons -------------------------------------------------------

export function getSermons(orgId: number): SermonRow[] {
  const rows = getDb()
    .prepare(
      `SELECT source_id, preached_on, title, scripture, speaker, topic, summary,
              themes, next_steps, confidence
         FROM sermons WHERE org_id=? ORDER BY preached_on ASC`,
    )
    .all(orgId) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    let next: Record<string, NextStepVal> = {};
    let themes: string[] = [];
    try {
      if (r.next_steps) next = JSON.parse(r.next_steps as string);
    } catch {
      /* leave empty */
    }
    try {
      if (r.themes) themes = JSON.parse(r.themes as string);
    } catch {
      /* leave empty */
    }
    return {
      source_id: r.source_id as number,
      preached_on: r.preached_on as string,
      title: (r.title as string) ?? null,
      scripture: (r.scripture as string) ?? null,
      speaker: (r.speaker as string) ?? null,
      topic: (r.topic as string) ?? null,
      summary: (r.summary as string) ?? null,
      themes,
      next_steps: next,
      confidence: (r.confidence as number) ?? null,
      classified: r.next_steps != null,
    };
  });
}

// ---- the analysis ----------------------------------------------------------

export interface CategoryStat {
  key: NextStepKey;
  label: string;
  measurable: boolean;
  metricLabel: string | null;
  /** Sundays with a strong call (intensity >= 2) for this step. */
  nCalled: number;
  /** Sundays without the call (intensity <= 1). */
  nControl: number;
  avgUpliftCalled: number | null; // MEDIAN deviation from local norm (0.06 = +6%)
  avgUpliftControl: number | null;
  contrast: number | null; // called - control, in points of %
  /** How often this step is preached at all (share of classified Sundays). */
  callShare: number;
}

export interface SermonImpactSummary {
  totalSermons: number;
  classifiedSermons: number;
  earliest: string | null;
  latest: string | null;
  categories: CategoryStat[];
  insights: SeasonalInsight[];
  recent: SermonDetailRow[];
  metricCoverage: Array<{ key: MetricKey; label: string; from: string | null; to: string | null }>;
}

export interface SermonDetailRow {
  source_id: number;
  preached_on: string;
  title: string | null;
  topic: string | null;
  calls: Array<{ key: NextStepKey; label: string; intensity: number }>;
  uplift: Partial<Record<MetricKey, number | null>>;
}

function pct(x: number | null): string {
  if (x == null) return "n/a";
  const v = Math.round(x * 100);
  return (v >= 0 ? "+" : "") + v + "%";
}

/** Collapse sermons to one record per Sunday, taking the max intensity seen
 *  for each category (two services / a weekend + midweek shouldn't double-count
 *  the same week's outcome window). */
function bySunday(sermons: SermonRow[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const s of sermons) {
    if (!s.classified) continue;
    const wk = sundayOf(s.preached_on);
    const cur = out.get(wk) ?? {};
    for (const step of NEXT_STEPS) {
      const v = s.next_steps[step.key];
      const inten = v?.called ? Math.max(v.intensity ?? 0, 1) : 0;
      cur[step.key] = Math.max(cur[step.key] ?? 0, inten);
    }
    out.set(wk, cur);
  }
  return out;
}

export function computeSermonImpact(orgId: number): SermonImpactSummary {
  const sermons = getSermons(orgId);
  const classified = sermons.filter((s) => s.classified);
  const metrics = getWeeklyMetrics(orgId);
  const sundays = bySunday(sermons);

  // Per-category contrast: uplift of the mapped metric after strong-call
  // Sundays vs no-call Sundays.
  const categories: CategoryStat[] = NEXT_STEPS.map((step) => {
    const series = step.metric ? metrics[step.metric] : null;
    const calledUp: number[] = [];
    const controlUp: number[] = [];
    let nCalledSundays = 0;
    let callSundays = 0;
    for (const [wk, cats] of sundays) {
      const inten = cats[step.key] ?? 0;
      if (inten >= 1) callSundays++;
      if (!series) continue;
      const u = upliftFor(series, wk);
      if (u == null) continue;
      if (inten >= 2) {
        calledUp.push(u);
        nCalledSundays++;
      } else if (inten <= 1) {
        controlUp.push(u);
      }
    }
    // Median across sermons — robust to the occasional launch-week outlier.
    const avgCalled = median(calledUp);
    const avgControl = median(controlUp);
    return {
      key: step.key,
      label: step.label,
      measurable: !!step.metric,
      metricLabel: step.metric ? METRIC_LABELS[step.metric] : null,
      nCalled: series ? nCalledSundays : calledSundaysCount(sundays, step.key),
      nControl: controlUp.length,
      avgUpliftCalled: avgCalled,
      avgUpliftControl: avgControl,
      contrast: avgCalled != null && avgControl != null ? avgCalled - avgControl : null,
      callShare: sundays.size ? callSundays / sundays.size : 0,
    };
  });

  const insights = buildInsights(categories);

  // Recent sermons with their calls + measured uplift, newest first.
  const recent: SermonDetailRow[] = classified
    .slice()
    .reverse()
    .slice(0, 60)
    .map((s) => {
      const wk = sundayOf(s.preached_on);
      const calls = NEXT_STEPS.filter((st) => s.next_steps[st.key]?.called)
        .map((st) => ({ key: st.key, label: st.label, intensity: s.next_steps[st.key].intensity ?? 0 }))
        .sort((a, b) => b.intensity - a.intensity);
      const uplift: Partial<Record<MetricKey, number | null>> = {};
      for (const m of ["group_apps", "new_servers", "new_attenders", "checkins"] as MetricKey[]) {
        uplift[m] = upliftFor(metrics[m], wk);
      }
      return { source_id: s.source_id, preached_on: s.preached_on, title: s.title, topic: s.topic, calls, uplift };
    });

  const metricCoverage = (Object.keys(metrics) as MetricKey[]).map((k) => ({
    key: k,
    label: METRIC_LABELS[k],
    from: metrics[k].minWk,
    to: metrics[k].maxWk,
  }));

  return {
    totalSermons: sermons.length,
    classifiedSermons: classified.length,
    earliest: classified[0]?.preached_on ?? null,
    latest: classified[classified.length - 1]?.preached_on ?? null,
    categories,
    insights,
    recent,
    metricCoverage,
  };
}

function calledSundaysCount(sundays: Map<string, Record<string, number>>, key: string): number {
  let n = 0;
  for (const [, cats] of sundays) if ((cats[key] ?? 0) >= 2) n++;
  return n;
}

/** Why a flat / slightly-negative result for these categories is a timing
 *  confound, not evidence that preaching backfires. */
const CONFOUND: Partial<Record<NextStepKey, string>> = {
  groups:
    "New group sign-ups cluster around the twice-a-year group launches a sermon usually accompanies, and that campaign timing swamps any week-to-week preaching effect.",
  serving:
    "First-time serving is mostly driven by scheduled team onboarding and ministry fairs, so it doesn't move with the individual week's message.",
  outreach:
    "First-time attendance also rides on holidays, invites, and events, so treat this as a lead rather than proof.",
};

function buildInsights(categories: CategoryStat[]): SeasonalInsight[] {
  const out: SeasonalInsight[] = [];
  for (const c of categories) {
    if (!c.measurable) continue;
    if (c.avgUpliftCalled == null || c.contrast == null || c.nCalled < 5) {
      out.push({
        title: `${c.label}: not enough sermons to measure yet`,
        detail: `Only ${c.nCalled} Sunday${c.nCalled === 1 ? "" : "s"} in range had a strong ${c.label.toLowerCase()} call with usable ${c.metricLabel} data around them. Need a few more to trust a number.`,
        tone: "neutral",
      });
      continue;
    }
    const contrastPts = Math.round(c.contrast * 100);
    const small = c.nCalled < 8;
    const ml = c.metricLabel ?? c.label.toLowerCase();
    const Ml = ml[0].toUpperCase() + ml.slice(1);
    if (contrastPts >= 4) {
      out.push({
        title: `${c.label} calls are followed by a modest rise in ${ml}`,
        detail:
          `In the 5 weeks after the ${c.nCalled} strongest ${c.label.toLowerCase()} calls, ${ml} ran a median ${pct(c.avgUpliftCalled)} above the local seasonal norm, vs ${pct(c.avgUpliftControl)} on the ${c.nControl} Sundays without a call — a +${contrastPts}-point difference.` +
          (small ? " Small sample — a lead, not proof." : ` ${CONFOUND[c.key] ?? ""}`),
        tone: "up",
      });
    } else if (contrastPts <= -4) {
      out.push({
        title: `${c.label}: no lift beyond normal timing`,
        detail: `${Ml} didn't rise after a ${c.label.toLowerCase()} call (median ${pct(c.avgUpliftCalled)} vs ${pct(c.avgUpliftControl)} without one). ${CONFOUND[c.key] ?? "This is a congregation-level signal only."}`,
        tone: "neutral",
      });
    } else {
      out.push({
        title: `${c.label}: about the same with or without a call`,
        detail: `${Ml} sat near the local norm whether or not the sermon made a ${c.label.toLowerCase()} call (median ${pct(c.avgUpliftCalled)} vs ${pct(c.avgUpliftControl)}).`,
        tone: "neutral",
      });
    }
  }
  // Giving caveat — detectable in sermons, not yet measurable as an outcome.
  const giving = categories.find((c) => c.key === "giving");
  if (giving) {
    out.push({
      title: "Giving response isn't measurable yet",
      detail: `Giving calls are detected in sermons (${Math.round(giving.callShare * 100)}% of classified Sundays touch on it), but Shepherdly has no dated gifts — only each donor's last-gift date — so there's no weekly giving series to correlate. A PushPay gifts/transactions export (or a "First Gift - Date" column) would unlock this.`,
      tone: "neutral",
    });
  }
  return out;
}

// ─── Explorer: list + detail for the Sermons page ──────────────────────────

/** Every classified sermon, newest first, with its tags — for the list page.
 *  (SermonListRow lives in next-step-types so client components can use it.) */
export function listSermons(orgId: number): SermonListRow[] {
  const rows = getDb()
    .prepare(
      `SELECT source_id, preached_on, title, speaker, topic, word_count, next_steps
         FROM sermons WHERE org_id = ? ORDER BY preached_on DESC`,
    )
    .all(orgId) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    let ns: Record<string, NextStepVal> = {};
    try {
      if (r.next_steps) ns = JSON.parse(r.next_steps as string);
    } catch {
      /* leave empty */
    }
    const calls = NEXT_STEPS.filter((s) => ns[s.key]?.called)
      .map((s) => ({ key: s.key, label: s.label, intensity: ns[s.key].intensity ?? 0 }))
      .sort((a, b) => b.intensity - a.intensity);
    return {
      sourceId: r.source_id as number,
      preachedOn: r.preached_on as string,
      title: (r.title as string) ?? null,
      speaker: (r.speaker as string) ?? null,
      topic: (r.topic as string) ?? null,
      wordCount: (r.word_count as number) ?? null,
      calls,
    };
  });
}

export interface SermonCall {
  key: NextStepKey;
  label: string;
  blurb: string;
  called: boolean;
  intensity: number;
  quote: string;
  /** Character range of the quote inside the transcript, or null when the
   *  classifier paraphrased and we can't locate it verbatim. */
  range: { start: number; end: number } | null;
}

export interface SermonDetail {
  sourceId: number;
  preachedOn: string;
  title: string | null;
  speaker: string | null;
  topic: string | null;
  summary: string | null;
  themes: string[];
  confidence: number | null;
  wordCount: number | null;
  transcript: string | null;
  calls: SermonCall[];
}

/** Locate a quote in the transcript, tolerating whitespace differences (the
 *  classifier's quotes are verbatim but may have collapsed newlines). Returns
 *  the character range in the ORIGINAL text, or null if not locatable. */
export function locateQuote(transcript: string, quote: string): { start: number; end: number } | null {
  if (!transcript || !quote) return null;
  const direct = transcript.indexOf(quote);
  if (direct >= 0) return { start: direct, end: direct + quote.length };

  // Whitespace-tolerant scan: walk the transcript building a normalized form
  // while remembering each normalized char's original index.
  const map: number[] = [];
  let norm = "";
  let prevSpace = false;
  for (let i = 0; i < transcript.length; i++) {
    const ch = transcript[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      prevSpace = true;
      map.push(i);
      norm += " ";
    } else {
      prevSpace = false;
      map.push(i);
      norm += ch.toLowerCase();
    }
  }
  const nq = quote.replace(/\s+/g, " ").trim().toLowerCase();
  const at = norm.indexOf(nq);
  if (at < 0) return null;
  const start = map[at];
  const endIdx = Math.min(at + nq.length - 1, map.length - 1);
  return { start, end: map[endIdx] + 1 };
}

export function getSermonDetail(orgId: number, sourceId: number): SermonDetail | null {
  const r = getDb()
    .prepare(
      `SELECT source_id, preached_on, title, speaker, topic, summary, themes,
              next_steps, confidence, word_count, transcript
         FROM sermons WHERE org_id = ? AND source_id = ?`,
    )
    .get(orgId, sourceId) as Record<string, unknown> | undefined;
  if (!r) return null;

  let ns: Record<string, NextStepVal> = {};
  let themes: string[] = [];
  try {
    if (r.next_steps) ns = JSON.parse(r.next_steps as string);
  } catch {
    /* leave empty */
  }
  try {
    if (r.themes) themes = JSON.parse(r.themes as string);
  } catch {
    /* leave empty */
  }
  const transcript = (r.transcript as string) ?? null;

  const calls: SermonCall[] = NEXT_STEPS.map((s) => {
    const v = ns[s.key] ?? { called: false, intensity: 0, quote: "" };
    const quote = (v.quote ?? "").trim();
    return {
      key: s.key,
      label: s.label,
      blurb: s.blurb,
      called: !!v.called,
      intensity: v.intensity ?? 0,
      quote,
      range: transcript && quote ? locateQuote(transcript, quote) : null,
    };
  });

  return {
    sourceId: r.source_id as number,
    preachedOn: r.preached_on as string,
    title: (r.title as string) ?? null,
    speaker: (r.speaker as string) ?? null,
    topic: (r.topic as string) ?? null,
    summary: (r.summary as string) ?? null,
    themes,
    confidence: (r.confidence as number) ?? null,
    wordCount: (r.word_count as number) ?? null,
    transcript,
    calls,
  };
}
