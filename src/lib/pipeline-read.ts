import "server-only";
import { getDb } from "./db";

// "How long does it take someone to go from interest -> action?"
// Two pipelines:
//  * Serving — a form submission (interest signal) -> first time the
//    person is scheduled on a service plan, per service type.
//  * Groups — a group application -> first time the person actually
//    attended an event for that group, per group AND per group type.
//
// Time-to-conversion is capped at PIPELINE_WINDOW_DAYS so a form
// submitted years before a first serve doesn't count as "pipeline".

const MS_PER_DAY = 86_400_000;
const PIPELINE_WINDOW_DAYS = 365;
const HISTORY_MONTHS = 60; // 5 years

export interface ConversionStats {
  /** People who converted (i.e. did the action after the interest). */
  count: number;
  medianDays: number | null;
  avgDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
}

export interface PipelineDim {
  key: string;
  name: string;
  stats: ConversionStats;
}

export interface PipelineBucket {
  /** "YYYY-MM" of the month the interest event landed in. */
  month: string;
  stats: ConversionStats;
}

export interface ServingPipelineSummary {
  overall: ConversionStats;
  byServiceType: PipelineDim[];
  history: PipelineBucket[];
}

export interface GroupPipelineSummary {
  overall: ConversionStats;
  byGroupType: PipelineDim[];
  byGroup: PipelineDim[];
  history: PipelineBucket[];
}

// ─── Aggregation helpers ──────────────────────────────────────────

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function statsFor(days: number[]): ConversionStats {
  if (days.length === 0) {
    return {
      count: 0,
      medianDays: null,
      avgDays: null,
      p25Days: null,
      p75Days: null,
    };
  }
  const sorted = [...days].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    medianDays: quantile(sorted, 0.5),
    avgDays: sum / sorted.length,
    p25Days: quantile(sorted, 0.25),
    p75Days: quantile(sorted, 0.75),
  };
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

/** Last N months ending with the current month, oldest -> newest. */
export function recentMonthKeys(n: number = HISTORY_MONTHS): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${yy}-${mm}`);
  }
  return out;
}

function bucketByMonth(
  rows: Array<{ startAt: string; days: number }>,
): PipelineBucket[] {
  const keys = recentMonthKeys();
  const allowed = new Set(keys);
  const byMonth = new Map<string, number[]>();
  for (const r of rows) {
    const k = monthKey(r.startAt);
    if (!allowed.has(k)) continue;
    const arr = byMonth.get(k) ?? [];
    arr.push(r.days);
    byMonth.set(k, arr);
  }
  return keys.map((k) => ({ month: k, stats: statsFor(byMonth.get(k) ?? []) }));
}

interface RawRow {
  startAt: string;
  endAt: string;
  dimKey: string;
  dimName: string | null;
  days: number;
}

function rollupByDim(rows: RawRow[]): PipelineDim[] {
  const groups = new Map<string, { name: string; days: number[] }>();
  for (const r of rows) {
    const g = groups.get(r.dimKey) ?? {
      name: r.dimName ?? `(unnamed #${r.dimKey})`,
      days: [],
    };
    g.days.push(r.days);
    groups.set(r.dimKey, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, name: g.name, stats: statsFor(g.days) }))
    .sort((a, b) => b.stats.count - a.stats.count);
}

// ─── Serving pipeline ─────────────────────────────────────────────

export function getServingPipeline(orgId: number): ServingPipelineSummary {
  const db = getDb();
  // For each (person, service_type), find the first time they were
  // scheduled to serve on a plan of that type. Join to the most-recent
  // form submission they made strictly before that first-serve date.
  // Trigger form is the LATEST form within the window — most likely
  // the one that actually drove the conversion.
  const raw = db
    .prepare(
      `WITH first_serve AS (
         SELECT pp.person_id, t.service_type_id,
                MIN(p.sort_date) AS first_serve_at
           FROM pco_plan_people pp
           JOIN pco_plans p
             ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
           JOIN pco_teams t
             ON t.org_id = pp.org_id AND t.pco_id = pp.team_id
          WHERE pp.org_id = ?
            AND pp.person_id != ''
            AND p.sort_date IS NOT NULL
            AND t.service_type_id IS NOT NULL
          GROUP BY pp.person_id, t.service_type_id
       )
       SELECT fs.person_id, fs.service_type_id AS dimKey,
              st.name AS dimName,
              fs.first_serve_at AS endAt,
              (SELECT MAX(sub.pco_created_at)
                 FROM pco_form_submissions sub
                WHERE sub.org_id = ?
                  AND sub.person_id = fs.person_id
                  AND sub.pco_created_at IS NOT NULL
                  AND sub.pco_created_at < fs.first_serve_at
              ) AS startAt
         FROM first_serve fs
         LEFT JOIN pco_service_types st
           ON st.org_id = ? AND st.pco_id = fs.service_type_id`,
    )
    .all(orgId, orgId, orgId) as Array<{
    person_id: string;
    dimKey: string;
    dimName: string | null;
    endAt: string;
    startAt: string | null;
  }>;

  const rows: RawRow[] = [];
  for (const r of raw) {
    if (!r.startAt || !r.endAt) continue;
    const days =
      (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / MS_PER_DAY;
    if (!Number.isFinite(days) || days < 0 || days > PIPELINE_WINDOW_DAYS) {
      continue;
    }
    rows.push({
      startAt: r.startAt,
      endAt: r.endAt,
      dimKey: r.dimKey,
      dimName: r.dimName,
      days,
    });
  }

  return {
    overall: statsFor(rows.map((r) => r.days)),
    byServiceType: rollupByDim(rows),
    history: bucketByMonth(rows),
  };
}

// ─── Group pipeline ───────────────────────────────────────────────

export function getGroupPipeline(orgId: number): GroupPipelineSummary {
  const db = getDb();
  const raw = db
    .prepare(
      `WITH first_app AS (
         SELECT person_id, group_id, MIN(applied_at) AS first_app_at
           FROM pco_group_applications
          WHERE org_id = ?
            AND person_id IS NOT NULL
            AND group_id IS NOT NULL
            AND applied_at IS NOT NULL
          GROUP BY person_id, group_id
       ), first_att AS (
         SELECT person_id, group_id, MIN(event_starts_at) AS first_att_at
           FROM pco_event_attendances
          WHERE org_id = ?
            AND attended = 1
            AND group_id IS NOT NULL
            AND event_starts_at IS NOT NULL
          GROUP BY person_id, group_id
       )
       SELECT fa.person_id, fa.group_id,
              g.group_type_id,
              g.name AS group_name,
              gt.name AS group_type_name,
              fa.first_app_at AS startAt,
              fatt.first_att_at AS endAt
         FROM first_app fa
         JOIN first_att fatt
           ON fatt.person_id = fa.person_id
          AND fatt.group_id = fa.group_id
         LEFT JOIN pco_groups g
           ON g.org_id = ? AND g.pco_id = fa.group_id
         LEFT JOIN pco_group_types gt
           ON gt.org_id = ? AND gt.pco_id = g.group_type_id`,
    )
    .all(orgId, orgId, orgId, orgId) as Array<{
    person_id: string;
    group_id: string;
    group_type_id: string | null;
    group_name: string | null;
    group_type_name: string | null;
    startAt: string;
    endAt: string;
  }>;

  const flatRows: RawRow[] = [];
  const byGroupRows: RawRow[] = [];
  const byTypeRows: RawRow[] = [];
  for (const r of raw) {
    if (!r.startAt || !r.endAt) continue;
    const days =
      (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / MS_PER_DAY;
    if (!Number.isFinite(days) || days < 0 || days > PIPELINE_WINDOW_DAYS) {
      continue;
    }
    const base = {
      startAt: r.startAt,
      endAt: r.endAt,
      days,
    };
    flatRows.push({ ...base, dimKey: r.group_id, dimName: r.group_name });
    byGroupRows.push({ ...base, dimKey: r.group_id, dimName: r.group_name });
    if (r.group_type_id) {
      byTypeRows.push({
        ...base,
        dimKey: r.group_type_id,
        dimName: r.group_type_name,
      });
    }
  }

  return {
    overall: statsFor(flatRows.map((r) => r.days)),
    byGroupType: rollupByDim(byTypeRows),
    byGroup: rollupByDim(byGroupRows),
    history: bucketByMonth(flatRows),
  };
}
