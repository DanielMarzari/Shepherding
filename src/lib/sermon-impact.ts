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
export { METRIC_LABELS } from "./next-steps-catalog";
export type { MetricKey } from "./next-steps-catalog";

import {
  NEXT_STEPS_CATALOG,
  METRIC_LABELS,
  type MetricKey,
  type NextStep,
} from "./next-steps-catalog";

/** The sermon next steps we keep: only the ones that are specific AND we could
 *  measure — give, join a group, serve, get baptized, become a member, and the
 *  named prayer gatherings. Abstract calls (follow Jesus, read Scripture,
 *  invite someone, care for others) are deliberately excluded: they can't be
 *  measured, so tagging them is noise. */
export const SERMON_STEPS: NextStep[] = NEXT_STEPS_CATALOG.filter(
  (s) => s.sermonKey || (s.sermonPatterns && s.sermonPatterns.length > 0),
);

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
  key: string;
  name: string;
  what: string;
  measurable: boolean;
  metricLabel: string | null;
  gap: string | null;
  nCalled: number;
  nControl: number;
  upliftCalled: number | null;
  upliftControl: number | null;
  contrast: number | null;
  callShare: number;
}

export interface SermonImpactSummary {
  totalSermons: number;
  classifiedSermons: number;
  earliest: string | null;
  latest: string | null;
  categories: CategoryStat[];
  insights: SeasonalInsight[];
}

function pct(x: number | null): string {
  if (x == null) return "n/a";
  const v = Math.round(x * 100);
  return (v >= 0 ? "+" : "") + v + "%";
}

/** Which narrowed next steps a sermon called for. `giving`/`groups`/`serving`
 *  come from the stored classifier; the rest are detected straight from the
 *  transcript, which also gives us the exact spot it was said. */
function callsForSermon(
  ns: Record<string, NextStepVal>,
  transcript: string | null,
): Map<string, { intensity: number; evidence: string; from: "classifier" | "transcript" }> {
  const out = new Map<string, { intensity: number; evidence: string; from: "classifier" | "transcript" }>();
  for (const step of SERMON_STEPS) {
    if (step.sermonKey) {
      const v = ns[step.sermonKey];
      if (v?.called) {
        out.set(step.key, {
          intensity: v.intensity ?? 1,
          evidence: (v.quote ?? "").trim(),
          from: "classifier",
        });
        continue;
      }
    }
    if (step.sermonPatterns && transcript) {
      for (const re of step.sermonPatterns) {
        const m = transcript.match(re);
        if (m) {
          const idx = m.index ?? 0;
          out.set(step.key, {
            intensity: 2,
            evidence: transcript.slice(Math.max(0, idx - 60), Math.min(transcript.length, idx + m[0].length + 60)).trim(),
            from: "transcript",
          });
          break;
        }
      }
    }
  }
  return out;
}

function gapForSermonStep(key: string): string {
  switch (key) {
    case "give":
      return "No dated gifts in Shepherdly — only each donor's last-gift date.";
    case "baptism":
      return "PCO records who staffed each baptism, not who was baptized.";
    case "membership":
      return "membership_type carries no date, so a change can't be dated.";
    default:
      return "No attendance record exists for this gathering.";
  }
}

/** Superset pre-filter for the transcript-detected sermon steps. Every
 *  `sermonPatterns` regex requires one of these substrings, so a sermon that
 *  fails this LIKE cannot match any of them. Lets the list page skip pulling
 *  10 MB of transcript text for a table of titles — we fetch transcripts only
 *  for the handful of candidates and then apply the exact regex, which is
 *  provably identical to scanning them all (verified: 0 mismatches / 429). */
const TRANSCRIPT_PREFILTER = `(transcript LIKE '%baptiz%' OR transcript LIKE '%baptis%'
   OR transcript LIKE '%prayer works%' OR transcript LIKE '%prayerworks%'
   OR transcript LIKE '%prayer night%' OR transcript LIKE '%night of prayer%')`;

export function computeSermonImpact(orgId: number): SermonImpactSummary {
  const sermons = getSermons(orgId);
  const classified = sermons.filter((s) => s.classified);
  const metrics = getWeeklyMetrics(orgId);
  const transcripts = new Map<number, string | null>(
    (
      getDb()
        .prepare(
          `SELECT source_id, transcript FROM sermons
            WHERE org_id = ? AND transcript IS NOT NULL AND ${TRANSCRIPT_PREFILTER}`,
        )
        .all(orgId) as Array<{ source_id: number; transcript: string | null }>
    ).map((r) => [r.source_id, r.transcript]),
  );

  // One record per Sunday (two services shouldn't double-count a week).
  const sundays = new Map<string, Set<string>>();
  for (const s of classified) {
    const wk = sundayOf(s.preached_on);
    const calls = callsForSermon(s.next_steps, transcripts.get(s.source_id) ?? null);
    const cur = sundays.get(wk) ?? new Set<string>();
    for (const k of calls.keys()) cur.add(k);
    sundays.set(wk, cur);
  }

  const categories: CategoryStat[] = SERMON_STEPS.map((step) => {
    const series = step.measure?.kind === "series" ? metrics[step.measure.metric] : null;
    const metricLabel = step.measure?.kind === "series" ? METRIC_LABELS[step.measure.metric] : null;
    const called: number[] = [];
    const control: number[] = [];
    let callSundays = 0;
    for (const [wk, set] of sundays) {
      const has = set.has(step.key);
      if (has) callSundays++;
      if (!series) continue;
      const u = upliftFor(series, wk);
      if (u == null) continue;
      if (has) called.push(u);
      else control.push(u);
    }
    const a = median(called);
    const c = median(control);
    return {
      key: step.key,
      name: step.name,
      what: step.what,
      measurable: !!series,
      metricLabel,
      gap: series ? null : gapForSermonStep(step.key),
      nCalled: series ? called.length : callSundays,
      nControl: control.length,
      upliftCalled: a,
      upliftControl: c,
      contrast: a != null && c != null ? a - c : null,
      callShare: sundays.size ? callSundays / sundays.size : 0,
    };
  });

  const insights: SeasonalInsight[] = [];
  for (const c of categories) {
    if (!c.measurable) continue;
    if (c.upliftCalled == null || c.contrast == null || c.nCalled < 5) {
      insights.push({
        title: `${c.name}: not enough sermons to measure`,
        detail: `Only ${c.nCalled} Sundays called for this with usable ${c.metricLabel} data around them.`,
        tone: "neutral",
      });
      continue;
    }
    const pts = Math.round(c.contrast * 100);
    insights.push({
      title:
        pts >= 4
          ? `Preaching “${c.name}” is followed by more ${c.metricLabel}`
          : pts <= -4
            ? `${c.name}: no lift beyond normal timing`
            : `${c.name}: about the same either way`,
      detail: `Median ${c.metricLabel} over the 5 weeks after: ${pct(c.upliftCalled)} on the ${c.nCalled} Sundays that called for it, vs ${pct(c.upliftControl)} on the ${c.nControl} that didn't${pts >= 4 || pts <= -4 ? ` — a ${pts > 0 ? "+" : ""}${pts}-point difference` : ""}. Campaign and launch timing usually moves these more than the sermon does.`,
      tone: pts >= 4 ? "up" : "neutral",
    });
  }
  const blocked = categories.filter((c) => !c.measurable && c.nCalled > 0);
  if (blocked.length) {
    insights.push({
      title: `${blocked.length} sermon next steps can't be scored yet`,
      detail: `${blocked.map((b) => b.name).join(", ")} are tagged where preached, but there's no record of who responded. ${blocked[0].gap}`,
      tone: "neutral",
    });
  }

  return {
    totalSermons: sermons.length,
    classifiedSermons: classified.length,
    earliest: classified[0]?.preached_on ?? null,
    latest: classified[classified.length - 1]?.preached_on ?? null,
    categories,
    insights,
  };
}

// ─── Explorer: list + detail for the Sermons page ──────────────────────────

export interface SermonListRow {
  sourceId: number;
  preachedOn: string;
  title: string | null;
  speaker: string | null;
  topic: string | null;
  wordCount: number | null;
  calls: Array<{ key: string; name: string; intensity: number }>;
}

export function listSermons(orgId: number): SermonListRow[] {
  const rows = getDb()
    .prepare(
      `SELECT source_id, preached_on, title, speaker, topic, word_count, next_steps
         FROM sermons WHERE org_id = ? ORDER BY preached_on DESC`,
    )
    .all(orgId) as Array<Record<string, unknown>>;

  // Only these sermons could possibly match a transcript-detected step.
  const candidates = new Map<number, string>(
    (
      getDb()
        .prepare(
          `SELECT source_id, transcript FROM sermons
            WHERE org_id = ? AND transcript IS NOT NULL AND ${TRANSCRIPT_PREFILTER}`,
        )
        .all(orgId) as Array<{ source_id: number; transcript: string }>
    ).map((r) => [r.source_id, r.transcript]),
  );

  return rows.map((r) => {
    let ns: Record<string, NextStepVal> = {};
    try {
      if (r.next_steps) ns = JSON.parse(r.next_steps as string);
    } catch {
      /* leave empty */
    }
    const id = r.source_id as number;
    const found = callsForSermon(ns, candidates.get(id) ?? null);
    const calls = SERMON_STEPS.filter((s) => found.has(s.key)).map((s) => ({
      key: s.key,
      name: s.name,
      intensity: found.get(s.key)!.intensity,
    }));
    return {
      sourceId: id,
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
  key: string;
  name: string;
  what: string;
  intensity: number;
  quote: string;
  from: "classifier" | "transcript";
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
  notCalled: string[];
}

/** Locate a quote in the transcript, tolerating whitespace differences.
 *  Returns a character range in the ORIGINAL text, or null. */
export function locateQuote(transcript: string, quote: string): { start: number; end: number } | null {
  if (!transcript || !quote) return null;
  const direct = transcript.indexOf(quote);
  if (direct >= 0) return { start: direct, end: direct + quote.length };
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
  const found = callsForSermon(ns, transcript);

  const calls: SermonCall[] = SERMON_STEPS.filter((s) => found.has(s.key)).map((s) => {
    const f = found.get(s.key)!;
    return {
      key: s.key,
      name: s.name,
      what: s.what,
      intensity: f.intensity,
      quote: f.evidence,
      from: f.from,
      range: transcript && f.evidence ? locateQuote(transcript, f.evidence) : null,
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
    notCalled: SERMON_STEPS.filter((s) => !found.has(s.key)).map((s) => s.name),
  };
}
