import "server-only";
import { getDb } from "./db";
import type { SeasonalInsight } from "./attendance-seasonal";
import {
  getWeeklyMetrics,
  upliftFor,
  METRIC_LABELS,
  NEXT_STEPS,
  sundayOf,
  type MetricKey,
  type NextStepKey,
} from "./sermon-impact";
import {
  gatherAnnouncementText,
  detectAnnouncements,
  type PlanItemLike,
} from "./plan-announcements";

// ---------------------------------------------------------------------------
// Announcement impact: what the church PROMOTED from the stage each Sunday
// (from the worship service order) vs measurable congregation activity in the
// 5 weeks after. Same categories, metrics, and robust uplift math as the
// sermon-impact page — but the "call" here is an explicit announcement
// (giving, small-group launch, serve push, prayer night, Discover class,
// campaign, invite) rather than the sermon's topic. This is usually a sharper
// next-step signal than the sermon itself.
// ---------------------------------------------------------------------------

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(x: number | null): string {
  if (x == null) return "n/a";
  const v = Math.round(x * 100);
  return (v >= 0 ? "+" : "") + v + "%";
}

interface PlanItemRow extends PlanItemLike {
  plan_id: string;
  sort_date: string | null;
}

/** Read every synced worship plan item, grouped by plan. */
function getPlanItemsByPlan(orgId: number): Map<string, { sortDate: string | null; items: PlanItemRow[] }> {
  const rows = getDb()
    .prepare(
      `SELECT pi.plan_id, pl.sort_date, pi.item_type, pi.title, pi.description, pi.html_details
         FROM pco_plan_items pi
         JOIN pco_plans pl ON pl.org_id = pi.org_id AND pl.pco_id = pi.plan_id
        WHERE pi.org_id = ?
        ORDER BY pi.plan_id, pi.sequence`,
    )
    .all(orgId) as PlanItemRow[];
  const byPlan = new Map<string, { sortDate: string | null; items: PlanItemRow[] }>();
  for (const r of rows) {
    let e = byPlan.get(r.plan_id);
    if (!e) {
      e = { sortDate: r.sort_date, items: [] };
      byPlan.set(r.plan_id, e);
    }
    e.items.push(r);
  }
  return byPlan;
}

interface SundayAnnouncements {
  categories: Set<NextStepKey>;
  evidence: Map<NextStepKey, string>; // one representative snippet per category
  services: number;
}

/** Collapse plans → one record per Sunday, unioning the categories announced
 *  across that day's services (Live + Chapel). */
function announcementsBySunday(orgId: number): Map<string, SundayAnnouncements> {
  const byPlan = getPlanItemsByPlan(orgId);
  const out = new Map<string, SundayAnnouncements>();
  for (const { sortDate, items } of byPlan.values()) {
    if (!sortDate) continue;
    const wk = sundayOf(sortDate);
    const text = gatherAnnouncementText(items);
    const detected = detectAnnouncements(text);
    let e = out.get(wk);
    if (!e) {
      e = { categories: new Set(), evidence: new Map(), services: 0 };
      out.set(wk, e);
    }
    e.services++;
    for (const d of detected) {
      e.categories.add(d.key);
      if (!e.evidence.has(d.key) && d.matches[0]) e.evidence.set(d.key, d.matches[0]);
    }
  }
  return out;
}

export interface AnnCategoryStat {
  key: NextStepKey;
  label: string;
  measurable: boolean;
  metricLabel: string | null;
  nAnnounced: number;
  nControl: number;
  upliftAnnounced: number | null; // median deviation from local norm
  upliftControl: number | null;
  contrast: number | null;
  announceShare: number; // share of Sundays that announced this
}

export interface AnnWeekRow {
  sunday: string;
  services: number;
  categories: Array<{ key: NextStepKey; label: string; evidence: string | null }>;
  uplift: Partial<Record<MetricKey, number | null>>;
}

export interface AnnouncementImpactSummary {
  weeksWithData: number;
  earliest: string | null;
  latest: string | null;
  categories: AnnCategoryStat[];
  insights: SeasonalInsight[];
  recent: AnnWeekRow[];
  metricCoverage: Array<{ key: MetricKey; label: string; from: string | null; to: string | null }>;
}

const RECENT_METRICS: MetricKey[] = ["group_apps", "new_servers", "new_attenders", "checkins"];

const CONFOUND: Partial<Record<NextStepKey, string>> = {
  groups:
    "Group sign-ups cluster around the twice-a-year launch the announcement accompanies, so campaign timing dominates any single week's effect.",
  serving:
    "First-time serving is largely driven by scheduled onboarding / ministry fairs, not the week it's announced.",
  outreach:
    "First-time attendance also rides on holidays and invites, so treat this as a lead, not proof.",
};

export function computeAnnouncementImpact(orgId: number): AnnouncementImpactSummary {
  const sundays = announcementsBySunday(orgId);
  const metrics = getWeeklyMetrics(orgId);
  const weeks = [...sundays.keys()].sort();

  const categories: AnnCategoryStat[] = NEXT_STEPS.map((step) => {
    const series = step.metric ? metrics[step.metric] : null;
    const announced: number[] = [];
    const control: number[] = [];
    let announceSundays = 0;
    let nAnnouncedWithData = 0;
    for (const [wk, ann] of sundays) {
      const has = ann.categories.has(step.key);
      if (has) announceSundays++;
      if (!series) continue;
      const u = upliftFor(series, wk);
      if (u == null) continue;
      if (has) {
        announced.push(u);
        nAnnouncedWithData++;
      } else {
        control.push(u);
      }
    }
    const a = median(announced);
    const c = median(control);
    return {
      key: step.key,
      label: step.label,
      measurable: !!step.metric,
      metricLabel: step.metric ? METRIC_LABELS[step.metric] : null,
      nAnnounced: series ? nAnnouncedWithData : announceSundays,
      nControl: control.length,
      upliftAnnounced: a,
      upliftControl: c,
      contrast: a != null && c != null ? a - c : null,
      announceShare: sundays.size ? announceSundays / sundays.size : 0,
    };
  });

  const insights = buildInsights(categories);

  const recent: AnnWeekRow[] = weeks
    .slice()
    .reverse()
    .slice(0, 60)
    .map((wk) => {
      const ann = sundays.get(wk)!;
      const cats = NEXT_STEPS.filter((s) => ann.categories.has(s.key)).map((s) => ({
        key: s.key,
        label: s.label,
        evidence: ann.evidence.get(s.key) ?? null,
      }));
      const uplift: Partial<Record<MetricKey, number | null>> = {};
      for (const m of RECENT_METRICS) uplift[m] = upliftFor(metrics[m], wk);
      return { sunday: wk, services: ann.services, categories: cats, uplift };
    });

  const metricCoverage = (Object.keys(metrics) as MetricKey[]).map((k) => ({
    key: k,
    label: METRIC_LABELS[k],
    from: metrics[k].minWk,
    to: metrics[k].maxWk,
  }));

  return {
    weeksWithData: sundays.size,
    earliest: weeks[0] ?? null,
    latest: weeks[weeks.length - 1] ?? null,
    categories,
    insights,
    recent,
    metricCoverage,
  };
}

function buildInsights(categories: AnnCategoryStat[]): SeasonalInsight[] {
  const out: SeasonalInsight[] = [];
  for (const c of categories) {
    if (!c.measurable) continue;
    const ml = c.metricLabel ?? c.label.toLowerCase();
    const Ml = ml[0].toUpperCase() + ml.slice(1);
    if (c.upliftAnnounced == null || c.contrast == null || c.nAnnounced < 5) {
      out.push({
        title: `${c.label}: not enough services to measure yet`,
        detail: `Only ${c.nAnnounced} Sunday${c.nAnnounced === 1 ? "" : "s"} announced ${c.label.toLowerCase()} with usable ${ml} data around them.`,
        tone: "neutral",
      });
      continue;
    }
    const contrastPts = Math.round(c.contrast * 100);
    const small = c.nAnnounced < 8;
    if (contrastPts >= 4) {
      out.push({
        title: `Announcing ${c.label.toLowerCase()} is followed by a rise in ${ml}`,
        detail:
          `In the 5 weeks after the ${c.nAnnounced} Sundays that announced ${c.label.toLowerCase()}, ${ml} ran a median ${pct(c.upliftAnnounced)} above the local seasonal norm, vs ${pct(c.upliftControl)} on the ${c.nControl} Sundays that didn't — a +${contrastPts}-point difference.` +
          (small ? " Small sample — a lead, not proof." : ` ${CONFOUND[c.key] ?? ""}`),
        tone: "up",
      });
    } else if (contrastPts <= -4) {
      out.push({
        title: `${c.label}: no lift beyond normal timing`,
        detail: `${Ml} didn't rise after a ${c.label.toLowerCase()} announcement (median ${pct(c.upliftAnnounced)} vs ${pct(c.upliftControl)} without one). ${CONFOUND[c.key] ?? "Congregation-level signal only."}`,
        tone: "neutral",
      });
    } else {
      out.push({
        title: `${c.label}: about the same with or without an announcement`,
        detail: `${Ml} sat near the local norm whether or not ${c.label.toLowerCase()} was announced (median ${pct(c.upliftAnnounced)} vs ${pct(c.upliftControl)}).`,
        tone: "neutral",
      });
    }
  }
  const giving = categories.find((c) => c.key === "giving");
  if (giving) {
    out.push({
      title: "Giving response isn't measurable yet",
      detail: `Giving is announced on ${Math.round(giving.announceShare * 100)}% of Sundays, but Shepherdly has no dated gifts (only each donor's last-gift date), so there's no weekly giving series to correlate. A PushPay gifts/transactions export would unlock it.`,
      tone: "neutral",
    });
  }
  return out;
}
