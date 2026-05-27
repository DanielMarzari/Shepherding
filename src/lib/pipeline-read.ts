import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

// "How long does it take someone to go from interest -> action?"
// Two pipelines:
//  * Serving — a submission of the configured serving-interest form
//    (set on /metrics) -> the first time the person is scheduled on
//    a service plan, per service type. People who start serving
//    without ever submitting the form are tallied separately. With no
//    form configured the trigger falls back to "any form submission".
//  * Groups — a group application -> first attended event for that
//    group, per group AND per group type.
//
// Time-to-conversion is capped at PIPELINE_WINDOW_DAYS so a form
// submitted years before a first serve doesn't count as "pipeline".

const MS_PER_DAY = 86_400_000;
const PIPELINE_WINDOW_DAYS = 365;
const HISTORY_MONTHS = 60; // 5 years
const UNTRIGGERED_SAMPLE = 50;

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export interface ConversionStats {
  count: number;
  minDays: number | null;
  p25Days: number | null;
  medianDays: number | null;
  p75Days: number | null;
  maxDays: number | null;
  avgDays: number | null;
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

export interface UntriggeredServer {
  personId: string;
  fullName: string;
  firstServeAt: string;
}

export interface PipelinePerson {
  personId: string;
  fullName: string;
  /** Days from interest -> action. */
  days: number;
  /** Trigger event ISO timestamp. */
  startAt: string;
  /** Action event ISO timestamp. */
  endAt: string;
}

export interface ServingPipelineDetail {
  serviceTypeId: string;
  serviceTypeName: string;
  formConfigured: boolean;
  formName: string | null;
  stats: ConversionStats;
  people: PipelinePerson[];
}

export interface GroupPipelineDetail {
  groupId: string;
  groupName: string;
  groupTypeName: string | null;
  stats: ConversionStats;
  people: PipelinePerson[];
}

export interface ServingPipelineSummary {
  /** Whether an admin has picked a specific serving-interest form. If
   *  false the trigger is the latest of ANY form submission. */
  formConfigured: boolean;
  formName: string | null;
  overall: ConversionStats;
  byServiceType: PipelineDim[];
  history: PipelineBucket[];
  /** People who started serving without ever submitting the configured
   *  serving-interest form. Only meaningful when a form is configured;
   *  empty otherwise. */
  untriggered: { count: number; sample: UntriggeredServer[] };
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
      minDays: null,
      p25Days: null,
      medianDays: null,
      p75Days: null,
      maxDays: null,
      avgDays: null,
    };
  }
  const sorted = [...days].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    minDays: sorted[0],
    p25Days: quantile(sorted, 0.25),
    medianDays: quantile(sorted, 0.5),
    p75Days: quantile(sorted, 0.75),
    maxDays: sorted[sorted.length - 1],
    avgDays: sum / sorted.length,
  };
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

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

function nameFromEncPii(encPii: string | null, personId: string): string {
  if (!encPii) return `(unknown #${personId})`;
  const pii = decryptJson<PIIBlob>(encPii);
  const name =
    [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") || "";
  return name || `(unknown #${personId})`;
}

// ─── Serving pipeline ─────────────────────────────────────────────

export function getServingPipeline(
  orgId: number,
  servingInterestFormId: string | null,
): ServingPipelineSummary {
  const db = getDb();
  const formId = servingInterestFormId ?? null;

  // Form name for display.
  let formName: string | null = null;
  if (formId) {
    const row = db
      .prepare(
        `SELECT COALESCE(NULLIF(name, ''), '(unnamed)') AS name
           FROM pco_forms WHERE org_id = ? AND pco_id = ?`,
      )
      .get(orgId, formId) as { name: string } | undefined;
    formName = row?.name ?? null;
  }

  // Trigger subquery — bound by formId when set, otherwise any form.
  // SQLite doesn't let us "optionally" filter cleanly in a single
  // prepared query, so we branch.
  const triggerSelect = formId
    ? `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = fs.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < fs.first_serve_at
          AND sub.form_id = ?`
    : `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = fs.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < fs.first_serve_at`;

  const rawStmt = db.prepare(
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
            (${triggerSelect}) AS startAt
       FROM first_serve fs
       LEFT JOIN pco_service_types st
         ON st.org_id = ? AND st.pco_id = fs.service_type_id`,
  );

  const raw = (formId
    ? rawStmt.all(orgId, orgId, formId, orgId)
    : rawStmt.all(orgId, orgId, orgId)) as Array<{
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

  // Untriggered servers — people whose first serve has NO matching
  // form-submission gate. Only computed when a form is configured.
  let untriggeredCount = 0;
  let untriggeredSample: UntriggeredServer[] = [];
  if (formId) {
    const untriggeredRows = db
      .prepare(
        `WITH first_serve_overall AS (
           SELECT pp.person_id, MIN(p.sort_date) AS first_serve_at
             FROM pco_plan_people pp
             JOIN pco_plans p
               ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
            WHERE pp.org_id = ?
              AND pp.person_id != ''
              AND p.sort_date IS NOT NULL
            GROUP BY pp.person_id
         )
         SELECT fso.person_id, fso.first_serve_at, ppl.enc_pii
           FROM first_serve_overall fso
           LEFT JOIN pco_people ppl
             ON ppl.org_id = ? AND ppl.pco_id = fso.person_id
          WHERE NOT EXISTS (
            SELECT 1 FROM pco_form_submissions sub
             WHERE sub.org_id = ?
               AND sub.person_id = fso.person_id
               AND sub.form_id = ?
               AND sub.pco_created_at IS NOT NULL
               AND sub.pco_created_at < fso.first_serve_at
          )
          ORDER BY fso.first_serve_at DESC`,
      )
      .all(orgId, orgId, orgId, formId) as Array<{
      person_id: string;
      first_serve_at: string;
      enc_pii: string | null;
    }>;
    untriggeredCount = untriggeredRows.length;
    untriggeredSample = untriggeredRows
      .slice(0, UNTRIGGERED_SAMPLE)
      .map((r) => ({
        personId: r.person_id,
        firstServeAt: r.first_serve_at,
        fullName: nameFromEncPii(r.enc_pii, r.person_id),
      }));
  }

  return {
    formConfigured: !!formId,
    formName,
    overall: statsFor(rows.map((r) => r.days)),
    byServiceType: rollupByDim(rows),
    history: bucketByMonth(rows),
    untriggered: { count: untriggeredCount, sample: untriggeredSample },
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
    const base = { startAt: r.startAt, endAt: r.endAt, days };
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

// ─── Detail views (drill-down) ────────────────────────────────────

/** Per-service-type person list for the serving pipeline. Same time
 *  window + same trigger-form filtering as the aggregate view, so the
 *  drill-down stays consistent with the rollup numbers. */
export function getServingPipelineDetail(
  orgId: number,
  servingInterestFormId: string | null,
  serviceTypeId: string,
): ServingPipelineDetail {
  const db = getDb();
  const formId = servingInterestFormId ?? null;

  const stInfo = db
    .prepare(
      `SELECT COALESCE(NULLIF(name, ''), '(unnamed service type)') AS name
         FROM pco_service_types WHERE org_id = ? AND pco_id = ?`,
    )
    .get(orgId, serviceTypeId) as { name: string } | undefined;
  const serviceTypeName = stInfo?.name ?? "(unknown service type)";

  let formName: string | null = null;
  if (formId) {
    const r = db
      .prepare(
        `SELECT COALESCE(NULLIF(name, ''), '(unnamed)') AS name
           FROM pco_forms WHERE org_id = ? AND pco_id = ?`,
      )
      .get(orgId, formId) as { name: string } | undefined;
    formName = r?.name ?? null;
  }

  const triggerSelect = formId
    ? `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = fs.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < fs.first_serve_at
          AND sub.form_id = ?`
    : `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = fs.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < fs.first_serve_at`;

  const stmt = db.prepare(
    `WITH first_serve AS (
       SELECT pp.person_id,
              MIN(p.sort_date) AS first_serve_at
         FROM pco_plan_people pp
         JOIN pco_plans p
           ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
         JOIN pco_teams t
           ON t.org_id = pp.org_id AND t.pco_id = pp.team_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND p.sort_date IS NOT NULL
          AND t.service_type_id = ?
        GROUP BY pp.person_id
     )
     SELECT fs.person_id,
            fs.first_serve_at AS endAt,
            (${triggerSelect}) AS startAt,
            ppl.enc_pii
       FROM first_serve fs
       LEFT JOIN pco_people ppl
         ON ppl.org_id = ? AND ppl.pco_id = fs.person_id`,
  );

  const raw = (formId
    ? stmt.all(orgId, serviceTypeId, orgId, formId, orgId)
    : stmt.all(orgId, serviceTypeId, orgId, orgId)) as Array<{
    person_id: string;
    endAt: string;
    startAt: string | null;
    enc_pii: string | null;
  }>;

  const people: PipelinePerson[] = [];
  for (const r of raw) {
    if (!r.startAt || !r.endAt) continue;
    const days =
      (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / MS_PER_DAY;
    if (!Number.isFinite(days) || days < 0 || days > PIPELINE_WINDOW_DAYS) {
      continue;
    }
    people.push({
      personId: r.person_id,
      fullName: nameFromEncPii(r.enc_pii, r.person_id),
      days,
      startAt: r.startAt,
      endAt: r.endAt,
    });
  }
  people.sort((a, b) => b.days - a.days);

  return {
    serviceTypeId,
    serviceTypeName,
    formConfigured: !!formId,
    formName,
    stats: statsFor(people.map((p) => p.days)),
    people,
  };
}

export function getGroupPipelineDetail(
  orgId: number,
  groupId: string,
): GroupPipelineDetail {
  const db = getDb();
  const gInfo = db
    .prepare(
      `SELECT COALESCE(NULLIF(g.name, ''), '(unnamed group)') AS name,
              gt.name AS group_type_name
         FROM pco_groups g
         LEFT JOIN pco_group_types gt
           ON gt.org_id = g.org_id AND gt.pco_id = g.group_type_id
        WHERE g.org_id = ? AND g.pco_id = ?`,
    )
    .get(orgId, groupId) as
    | { name: string; group_type_name: string | null }
    | undefined;
  const groupName = gInfo?.name ?? "(unknown group)";
  const groupTypeName = gInfo?.group_type_name ?? null;

  const raw = db
    .prepare(
      `WITH first_app AS (
         SELECT person_id, MIN(applied_at) AS first_app_at
           FROM pco_group_applications
          WHERE org_id = ?
            AND group_id = ?
            AND person_id IS NOT NULL
            AND applied_at IS NOT NULL
          GROUP BY person_id
       ), first_att AS (
         SELECT person_id, MIN(event_starts_at) AS first_att_at
           FROM pco_event_attendances
          WHERE org_id = ?
            AND group_id = ?
            AND attended = 1
            AND event_starts_at IS NOT NULL
          GROUP BY person_id
       )
       SELECT fa.person_id,
              fa.first_app_at AS startAt,
              fatt.first_att_at AS endAt,
              ppl.enc_pii
         FROM first_app fa
         JOIN first_att fatt ON fatt.person_id = fa.person_id
         LEFT JOIN pco_people ppl
           ON ppl.org_id = ? AND ppl.pco_id = fa.person_id`,
    )
    .all(orgId, groupId, orgId, groupId, orgId) as Array<{
    person_id: string;
    startAt: string;
    endAt: string;
    enc_pii: string | null;
  }>;

  const people: PipelinePerson[] = [];
  for (const r of raw) {
    if (!r.startAt || !r.endAt) continue;
    const days =
      (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / MS_PER_DAY;
    if (!Number.isFinite(days) || days < 0 || days > PIPELINE_WINDOW_DAYS) {
      continue;
    }
    people.push({
      personId: r.person_id,
      fullName: nameFromEncPii(r.enc_pii, r.person_id),
      days,
      startAt: r.startAt,
      endAt: r.endAt,
    });
  }
  people.sort((a, b) => b.days - a.days);

  return {
    groupId,
    groupName,
    groupTypeName,
    stats: statsFor(people.map((p) => p.days)),
    people,
  };
}
