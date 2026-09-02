import "server-only";
import { getDb } from "./db";
import type { SeasonalInsight } from "./attendance-seasonal";
import { getWeeklyMetrics, upliftFor, sundayOf } from "./sermon-impact";
import {
  NEXT_STEPS_CATALOG,
  STEP_BY_KEY,
  CATEGORY_LABELS,
  METRIC_LABELS,
  type StepCategory,
} from "./next-steps-catalog";
import {
  gatherAnnouncementText,
  detectAnnouncements,
  isAnnouncementItem,
  itemText,
  type PlanItemLike,
} from "./plan-announcements";

// ---------------------------------------------------------------------------
// Announcement impact: which SPECIFIC next steps were announced from the stage
// each Sunday, and — for the ones we actually have outcome data for — whether
// anything moved in the 5 weeks after.
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

interface SundaySteps {
  steps: Set<string>;
  evidence: Map<string, string>;
  services: number;
  planIds: string[];
}

function stepsBySunday(orgId: number): Map<string, SundaySteps> {
  const byPlan = getPlanItemsByPlan(orgId);
  const out = new Map<string, SundaySteps>();
  for (const [planId, { sortDate, items }] of byPlan) {
    if (!sortDate) continue;
    const wk = sundayOf(sortDate);
    const detected = detectAnnouncements(gatherAnnouncementText(items));
    let e = out.get(wk);
    if (!e) {
      e = { steps: new Set(), evidence: new Map(), services: 0, planIds: [] };
      out.set(wk, e);
    }
    e.services++;
    e.planIds.push(planId);
    for (const d of detected) {
      e.steps.add(d.key);
      if (!e.evidence.has(d.key) && d.matches[0]) e.evidence.set(d.key, d.matches[0]);
    }
  }
  return out;
}

/** Weekly check-in counts for the events matching a step's `checkinEvent`
 *  measure — the only per-event attendance we actually have. */
function checkinSeriesFor(orgId: number, match: RegExp) {
  const rows = getDb()
    .prepare(
      `SELECT date(c.event_time_at, '-' || strftime('%w', c.event_time_at) || ' days') wk,
              e.name AS name, COUNT(*) c
         FROM pco_check_ins c
         JOIN pco_checkin_events e ON e.org_id = c.org_id AND e.pco_id = c.event_id
        WHERE c.org_id = ? AND c.event_time_at IS NOT NULL AND c.event_time_at <> ''
        GROUP BY wk, e.pco_id`,
    )
    .all(orgId) as Array<{ wk: string; name: string | null; c: number }>;
  const byWeek = new Map<string, number>();
  let minWk: string | null = null;
  let maxWk: string | null = null;
  for (const r of rows) {
    if (!r.wk || !match.test(r.name ?? "")) continue;
    byWeek.set(r.wk, (byWeek.get(r.wk) ?? 0) + r.c);
    if (minWk === null || r.wk < minWk) minWk = r.wk;
    if (maxWk === null || r.wk > maxWk) maxWk = r.wk;
  }
  return { byWeek, minWk, maxWk };
}

export interface StepStat {
  key: string;
  name: string;
  category: StepCategory;
  categoryLabel: string;
  what: string;
  /** Sundays this was announced on. */
  announced: number;
  announceShare: number;
  /** How a response is measured, in words — or null when we have no data. */
  measureLabel: string | null;
  /** Why we can't measure it, when we can't. */
  gap: string | null;
  nAnnouncedWithData: number;
  nControl: number;
  upliftAnnounced: number | null;
  upliftControl: number | null;
  contrast: number | null;
}

export interface AnnWeekRow {
  sunday: string;
  services: number;
  planIds: string[];
  steps: Array<{ key: string; name: string; categoryLabel: string; evidence: string | null }>;
}

export interface AnnouncementImpactSummary {
  weeksWithData: number;
  earliest: string | null;
  latest: string | null;
  steps: StepStat[];
  insights: SeasonalInsight[];
  recent: AnnWeekRow[];
}

/** Plain-English reason a step has no measurable outcome. */
function gapFor(key: string): string {
  switch (STEP_BY_KEY[key]?.category) {
    case "give":
      return "No dated gifts in Shepherdly (only each donor's last-gift date). A PushPay gifts/transactions export would unlock this.";
    case "baptism":
      return "PCO records who STAFFED each baptism service (greeters, dunker), not who was baptized. A baptism roster, form, or check-in would unlock this.";
    case "membership":
      return "membership_type has no date, so we can't tell when someone became a member. A dated membership workflow/field would unlock this.";
    case "class":
      return "Class attendance isn't recorded — PCO only has the team who staffed the class. Turning on check-in (or a signup form) for the class would unlock this.";
    case "prayer":
      return "PCO holds the prayer-partner roster, not who attended. Check-in at the gathering would unlock this.";
    case "care":
      return "No attendance or intake records for these ministries yet. A signup form or check-in would unlock this.";
    default:
      return "No outcome data is tracked for this yet.";
  }
}

export function computeAnnouncementImpact(orgId: number): AnnouncementImpactSummary {
  const sundays = stepsBySunday(orgId);
  const metrics = getWeeklyMetrics(orgId);
  const weeks = [...sundays.keys()].sort();
  const checkinCache = new Map<string, ReturnType<typeof checkinSeriesFor>>();

  const steps: StepStat[] = NEXT_STEPS_CATALOG.map((step) => {
    let series: { byWeek: Map<string, number>; minWk: string | null; maxWk: string | null } | null = null;
    let measureLabel: string | null = null;
    if (step.measure?.kind === "series") {
      series = metrics[step.measure.metric];
      measureLabel = METRIC_LABELS[step.measure.metric];
    } else if (step.measure?.kind === "checkinEvent") {
      if (!checkinCache.has(step.key)) checkinCache.set(step.key, checkinSeriesFor(orgId, step.measure.match));
      series = checkinCache.get(step.key)!;
      measureLabel = step.measure.label;
    }

    const announcedUp: number[] = [];
    const controlUp: number[] = [];
    let announced = 0;
    for (const [wk, s] of sundays) {
      const has = s.steps.has(step.key);
      if (has) announced++;
      if (!series) continue;
      const u = upliftFor(series, wk);
      if (u == null) continue;
      if (has) announcedUp.push(u);
      else controlUp.push(u);
    }
    const a = median(announcedUp);
    const c = median(controlUp);
    return {
      key: step.key,
      name: step.name,
      category: step.category,
      categoryLabel: CATEGORY_LABELS[step.category],
      what: step.what,
      announced,
      announceShare: sundays.size ? announced / sundays.size : 0,
      measureLabel,
      gap: series ? null : gapFor(step.key),
      nAnnouncedWithData: announcedUp.length,
      nControl: controlUp.length,
      upliftAnnounced: a,
      upliftControl: c,
      contrast: a != null && c != null ? a - c : null,
    };
  });

  const recent: AnnWeekRow[] = weeks
    .slice()
    .reverse()
    .slice(0, 60)
    .map((wk) => {
      const s = sundays.get(wk)!;
      return {
        sunday: wk,
        services: s.services,
        planIds: s.planIds,
        steps: NEXT_STEPS_CATALOG.filter((t) => s.steps.has(t.key)).map((t) => ({
          key: t.key,
          name: t.name,
          categoryLabel: CATEGORY_LABELS[t.category],
          evidence: s.evidence.get(t.key) ?? null,
        })),
      };
    });

  return {
    weeksWithData: sundays.size,
    earliest: weeks[0] ?? null,
    latest: weeks[weeks.length - 1] ?? null,
    steps,
    insights: buildInsights(steps),
    recent,
  };
}

function buildInsights(steps: StepStat[]): SeasonalInsight[] {
  const out: SeasonalInsight[] = [];
  for (const s of steps) {
    if (!s.measureLabel) continue; // unmeasurable steps are reported separately
    if (s.upliftAnnounced == null || s.contrast == null || s.nAnnouncedWithData < 5) {
      out.push({
        title: `${s.name}: not enough announcements to measure`,
        detail: `Announced on ${s.announced} Sunday${s.announced === 1 ? "" : "s"}, but only ${s.nAnnouncedWithData} have usable ${s.measureLabel} data around them.`,
        tone: "neutral",
      });
      continue;
    }
    const pts = Math.round(s.contrast * 100);
    const small = s.nAnnouncedWithData < 8;
    if (pts >= 4) {
      out.push({
        title: `“${s.name}” is followed by more ${s.measureLabel}`,
        detail:
          `In the 5 weeks after the ${s.nAnnouncedWithData} Sundays announcing it, ${s.measureLabel} ran a median ${pct(s.upliftAnnounced)} vs the local norm, against ${pct(s.upliftControl)} on the ${s.nControl} Sundays without it — a +${pts}-point difference.` +
          (small ? " Small sample — a lead, not proof." : " The announcement usually rides along with the launch/campaign, which does much of the work."),
        tone: "up",
      });
    } else if (pts <= -4) {
      out.push({
        title: `${s.name}: no lift beyond normal timing`,
        detail: `${s.measureLabel} didn't rise after this announcement (median ${pct(s.upliftAnnounced)} vs ${pct(s.upliftControl)} without it).`,
        tone: "neutral",
      });
    } else {
      out.push({
        title: `${s.name}: about the same either way`,
        detail: `${s.measureLabel} sat near the local norm whether or not it was announced (${pct(s.upliftAnnounced)} vs ${pct(s.upliftControl)}).`,
        tone: "neutral",
      });
    }
  }
  const blocked = steps.filter((s) => !s.measureLabel && s.announced > 0);
  if (blocked.length) {
    out.push({
      title: `${blocked.length} next steps are tagged but can't be scored yet`,
      detail: `We know exactly when each was announced (${blocked
        .slice(0, 4)
        .map((s) => s.name)
        .join(", ")}${blocked.length > 4 ? ", …" : ""}), but there's no attendance or signup record to measure the response against. Each card below says what would unlock it.`,
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
  steps: Array<{ key: string; name: string }>;
}

export function listServicePlans(orgId: number, limit = 800): PlanListRow[] {
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
    .all(orgId, limit) as Array<Omit<PlanListRow, "steps">>;

  const byPlan = getPlanItemsByPlan(orgId);
  return meta.map((m) => {
    const items = byPlan.get(m.planId)?.items ?? [];
    const detected = detectAnnouncements(gatherAnnouncementText(items));
    return {
      ...m,
      steps: detected.map((d) => ({ key: d.key, name: STEP_BY_KEY[d.key]?.name ?? d.key })),
    };
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
  steps: Array<{
    key: string;
    name: string;
    categoryLabel: string;
    what: string;
    measureLabel: string | null;
    gap: string | null;
    matches: string[];
  }>;
}

export function getServicePlan(orgId: number, planId: string): PlanDetail | null {
  const head = getDb()
    .prepare(
      `SELECT pl.pco_id AS planId, pl.sort_date AS sortDate, pl.title AS title, st.name AS serviceTypeName
         FROM pco_plans pl
         LEFT JOIN pco_service_types st ON st.org_id = pl.org_id AND st.pco_id = pl.service_type_id
        WHERE pl.org_id = ? AND pl.pco_id = ?`,
    )
    .get(orgId, planId) as Omit<PlanDetail, "items" | "steps"> | undefined;
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

  const likes: PlanItemLike[] = rows.map((r) => ({
    item_type: r.item_type,
    title: r.title,
    description: r.description,
    html_details: r.html_details,
  }));

  const items: PlanDetailItem[] = rows.map((r, i) => ({
    pcoId: r.pco_id,
    sequence: r.sequence,
    itemType: r.item_type,
    title: r.title,
    text: itemText(likes[i]),
    scanned: isAnnouncementItem(likes[i]),
  }));

  const steps = detectAnnouncements(gatherAnnouncementText(likes)).map((d) => {
    const t = STEP_BY_KEY[d.key];
    const measureLabel =
      t.measure?.kind === "series"
        ? METRIC_LABELS[t.measure.metric]
        : t.measure?.kind === "checkinEvent"
          ? t.measure.label
          : null;
    return {
      key: t.key,
      name: t.name,
      categoryLabel: CATEGORY_LABELS[t.category],
      what: t.what,
      measureLabel,
      gap: measureLabel ? null : gapFor(t.key),
      matches: d.matches,
    };
  });

  return { ...head, items, steps };
}
