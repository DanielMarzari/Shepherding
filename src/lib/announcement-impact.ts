import "server-only";
import { getDb } from "./db";
import type { SeasonalInsight } from "./attendance-seasonal";
import {
  getWeeklyMetrics,
  upliftFor,
  METRIC_LABELS,
  sundayOf,
  type MetricKey,
} from "./sermon-impact";
import {
  ANNOUNCEMENT_TYPES,
  gatherAnnouncementText,
  detectAnnouncements,
  isAnnouncementItem as isScanned,
  itemText as textOf,
  type PlanItemLike,
} from "./plan-announcements";

// ---------------------------------------------------------------------------
// Announcement impact: what the church PROMOTED from the stage each Sunday
// (from the worship service order) vs measurable congregation activity in the
// 5 weeks after. Same metrics and robust uplift math as sermon-impact — but
// the "call" here is an explicit announcement, which is usually a sharper
// next-step signal than a sermon's topic.
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
  types: Set<string>;
  evidence: Map<string, string>;
  services: number;
}

function announcementsBySunday(orgId: number): Map<string, SundayAnnouncements> {
  const byPlan = getPlanItemsByPlan(orgId);
  const out = new Map<string, SundayAnnouncements>();
  for (const { sortDate, items } of byPlan.values()) {
    if (!sortDate) continue;
    const wk = sundayOf(sortDate);
    const detected = detectAnnouncements(gatherAnnouncementText(items));
    let e = out.get(wk);
    if (!e) {
      e = { types: new Set(), evidence: new Map(), services: 0 };
      out.set(wk, e);
    }
    e.services++;
    for (const d of detected) {
      e.types.add(d.key);
      if (!e.evidence.has(d.key) && d.matches[0]) e.evidence.set(d.key, d.matches[0]);
    }
  }
  return out;
}

export interface AnnCategoryStat {
  key: string;
  label: string;
  what: string;
  measurable: boolean;
  metricLabel: string | null;
  nAnnounced: number;
  nControl: number;
  upliftAnnounced: number | null;
  upliftControl: number | null;
  contrast: number | null;
  announceShare: number;
}

export interface AnnWeekRow {
  sunday: string;
  services: number;
  planIds: string[];
  types: Array<{ key: string; label: string; evidence: string | null }>;
  uplift: Partial<Record<MetricKey, number | null>>;
}

export interface AnnouncementImpactSummary {
  weeksWithData: number;
  earliest: string | null;
  latest: string | null;
  categories: AnnCategoryStat[];
  insights: SeasonalInsight[];
  recent: AnnWeekRow[];
}

const RECENT_METRICS: MetricKey[] = ["group_apps", "new_servers", "new_attenders", "checkins"];

const CONFOUND: Record<string, string> = {
  groups:
    "Group sign-ups cluster around the twice-a-year launch the announcement accompanies, so campaign timing does most of the work.",
  serving:
    "First-time serving is largely driven by scheduled onboarding / ministry fairs, not the week it's announced.",
  invite:
    "First-time attendance also rides on holidays and personal invites, so treat this as a lead, not proof.",
};

export function computeAnnouncementImpact(orgId: number): AnnouncementImpactSummary {
  const sundays = announcementsBySunday(orgId);
  const metrics = getWeeklyMetrics(orgId);
  const weeks = [...sundays.keys()].sort();
  const planIdsByWeek = new Map<string, string[]>();
  for (const [planId, { sortDate }] of getPlanItemsByPlan(orgId)) {
    if (!sortDate) continue;
    const wk = sundayOf(sortDate);
    const arr = planIdsByWeek.get(wk) ?? [];
    arr.push(planId);
    planIdsByWeek.set(wk, arr);
  }

  const categories: AnnCategoryStat[] = ANNOUNCEMENT_TYPES.map((t) => {
    const series = t.metric ? metrics[t.metric] : null;
    const announced: number[] = [];
    const control: number[] = [];
    let announceSundays = 0;
    let nAnnouncedWithData = 0;
    for (const [wk, ann] of sundays) {
      const has = ann.types.has(t.key);
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
      key: t.key,
      label: t.label,
      what: t.what,
      measurable: !!t.metric,
      metricLabel: t.metric ? METRIC_LABELS[t.metric] : null,
      nAnnounced: series ? nAnnouncedWithData : announceSundays,
      nControl: control.length,
      upliftAnnounced: a,
      upliftControl: c,
      contrast: a != null && c != null ? a - c : null,
      announceShare: sundays.size ? announceSundays / sundays.size : 0,
    };
  });

  const recent: AnnWeekRow[] = weeks
    .slice()
    .reverse()
    .slice(0, 60)
    .map((wk) => {
      const ann = sundays.get(wk)!;
      const types = ANNOUNCEMENT_TYPES.filter((t) => ann.types.has(t.key)).map((t) => ({
        key: t.key,
        label: t.label,
        evidence: ann.evidence.get(t.key) ?? null,
      }));
      const uplift: Partial<Record<MetricKey, number | null>> = {};
      for (const m of RECENT_METRICS) uplift[m] = upliftFor(metrics[m], wk);
      return { sunday: wk, services: ann.services, planIds: planIdsByWeek.get(wk) ?? [], types, uplift };
    });

  return {
    weeksWithData: sundays.size,
    earliest: weeks[0] ?? null,
    latest: weeks[weeks.length - 1] ?? null,
    categories,
    insights: buildInsights(categories),
    recent,
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
        detail: `Only ${c.nAnnounced} Sunday${c.nAnnounced === 1 ? "" : "s"} announced this with usable ${ml} data around them.`,
        tone: "neutral",
      });
      continue;
    }
    const contrastPts = Math.round(c.contrast * 100);
    const small = c.nAnnounced < 8;
    if (contrastPts >= 4) {
      out.push({
        title: `“${c.label}” is followed by a rise in ${ml}`,
        detail:
          `In the 5 weeks after the ${c.nAnnounced} Sundays that announced it, ${ml} ran a median ${pct(c.upliftAnnounced)} above the local seasonal norm, vs ${pct(c.upliftControl)} on the ${c.nControl} Sundays that didn't — a +${contrastPts}-point difference.` +
          (small ? " Small sample — a lead, not proof." : ` ${CONFOUND[c.key] ?? ""}`),
        tone: "up",
      });
    } else if (contrastPts <= -4) {
      out.push({
        title: `${c.label}: no lift beyond normal timing`,
        detail: `${Ml} didn't rise after this announcement (median ${pct(c.upliftAnnounced)} vs ${pct(c.upliftControl)} without it). ${CONFOUND[c.key] ?? "Congregation-level signal only."}`,
        tone: "neutral",
      });
    } else {
      out.push({
        title: `${c.label}: about the same either way`,
        detail: `${Ml} sat near the local norm whether or not it was announced (median ${pct(c.upliftAnnounced)} vs ${pct(c.upliftControl)}).`,
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

// ─── Explorer: list + detail for the Service plans page ────────────────────

export interface PlanListRow {
  planId: string;
  sortDate: string | null;
  serviceTypeName: string | null;
  title: string | null;
  itemCount: number;
  types: Array<{ key: string; label: string }>;
}

export function listServicePlans(orgId: number, limit = 500): PlanListRow[] {
  const meta = getDb()
    .prepare(
      `SELECT pl.pco_id AS planId, pl.sort_date AS sortDate, pl.title AS title,
              st.name AS serviceTypeName, COUNT(pi.pco_id) AS itemCount
         FROM pco_plans pl
         JOIN pco_plan_items pi ON pi.org_id = pl.org_id AND pi.plan_id = pl.pco_id
         LEFT JOIN pco_service_types st ON st.org_id = pl.org_id AND st.pco_id = pl.service_type_id
        WHERE pl.org_id = ?
        GROUP BY pl.pco_id
        ORDER BY pl.sort_date DESC
        LIMIT ?`,
    )
    .all(orgId, limit) as Array<Omit<PlanListRow, "types">>;

  const byPlan = getPlanItemsByPlan(orgId);
  return meta.map((m) => {
    const items = byPlan.get(m.planId)?.items ?? [];
    const detected = detectAnnouncements(gatherAnnouncementText(items));
    const types = detected.map((d) => ({
      key: d.key,
      label: ANNOUNCEMENT_TYPES.find((t) => t.key === d.key)?.label ?? d.key,
    }));
    return { ...m, types };
  });
}

export interface PlanDetailItem {
  pcoId: string;
  sequence: number | null;
  itemType: string | null;
  title: string | null;
  text: string;
  scanned: boolean;
}

export interface PlanDetail {
  planId: string;
  sortDate: string | null;
  title: string | null;
  serviceTypeName: string | null;
  items: PlanDetailItem[];
  types: Array<{ key: string; label: string; what: string; matches: string[] }>;
}

export function getServicePlan(orgId: number, planId: string): PlanDetail | null {
  const head = getDb()
    .prepare(
      `SELECT pl.pco_id AS planId, pl.sort_date AS sortDate, pl.title AS title, st.name AS serviceTypeName
         FROM pco_plans pl
         LEFT JOIN pco_service_types st ON st.org_id = pl.org_id AND st.pco_id = pl.service_type_id
        WHERE pl.org_id = ? AND pl.pco_id = ?`,
    )
    .get(orgId, planId) as Omit<PlanDetail, "items" | "types"> | undefined;
  if (!head) return null;

  const rows = getDb()
    .prepare(
      `SELECT pco_id, sequence, item_type, title, description, html_details
         FROM pco_plan_items WHERE org_id = ? AND plan_id = ? ORDER BY sequence`,
    )
    .all(orgId, planId) as Array<{
    pco_id: string;
    sequence: number | null;
    item_type: string | null;
    title: string | null;
    description: string | null;
    html_details: string | null;
  }>;

  const items: PlanDetailItem[] = rows.map((r) => {
    const like: PlanItemLike = {
      item_type: r.item_type,
      title: r.title,
      description: r.description,
      html_details: r.html_details,
    };
    const scanned = isScanned(like);
    return {
      pcoId: r.pco_id,
      sequence: r.sequence,
      itemType: r.item_type,
      title: r.title,
      text: textOf(like),
      scanned,
    };
  });

  const detected = detectAnnouncements(gatherAnnouncementText(rows.map(toLike)));
  const types = detected.map((d) => {
    const t = ANNOUNCEMENT_TYPES.find((x) => x.key === d.key)!;
    return { key: t.key, label: t.label, what: t.what, matches: d.matches };
  });

  return { ...head, items, types };
}

function toLike(r: {
  item_type: string | null;
  title: string | null;
  description: string | null;
  html_details: string | null;
}): PlanItemLike {
  return { item_type: r.item_type, title: r.title, description: r.description, html_details: r.html_details };
}
