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
  /** Count of people who started serving without ever submitting the
   *  configured serving-interest form. 0 when no form is configured. */
  untriggered: { count: number };
  /** Two-stage breakdown: time-to-scheduled vs time-to-first-served.
   *  Both are bounded by PIPELINE_WINDOW_DAYS. */
  stages: ServingPipelineStages;
}

export interface GroupPipelineSummary {
  overall: ConversionStats;
  byGroupType: PipelineDim[];
  byGroup: PipelineDim[];
  history: PipelineBucket[];
  /** Two-stage breakdown so we can see WHERE the time goes — admin
   *  approval lag vs. "showed up to the first event" lag. */
  stages: PipelineStages;
}

export interface PipelineStages {
  /** Apply → join (admin approves + person is added to the roster). */
  applyToJoin: ConversionStats;
  /** Join → first attended event. */
  joinToAttend: ConversionStats;
}

export interface ServingPipelineStages {
  /** Form submission → first time scheduled on a plan. */
  formToSchedule: ConversionStats;
  /** First scheduled → first actually served (status not declined). */
  scheduleToServe: ConversionStats;
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
  // form-submission gate. Only the COUNT is shown on /pipeline (the
  // list of names isn't actionable enough to justify the decryption
  // cost on every page load).
  let untriggeredCount = 0;
  if (formId) {
    const row = db
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
         SELECT COUNT(*) AS c
           FROM first_serve_overall fso
          WHERE NOT EXISTS (
            SELECT 1 FROM pco_form_submissions sub
             WHERE sub.org_id = ?
               AND sub.person_id = fso.person_id
               AND sub.form_id = ?
               AND sub.pco_created_at IS NOT NULL
               AND sub.pco_created_at < fso.first_serve_at
          )`,
      )
      .get(orgId, orgId, formId) as { c: number } | undefined;
    untriggeredCount = row?.c ?? 0;
  }

  return {
    formConfigured: !!formId,
    formName,
    overall: statsFor(rows.map((r) => r.days)),
    byServiceType: rollupByDim(rows),
    history: bucketByMonth(rows),
    untriggered: { count: untriggeredCount },
    stages: getServingPipelineStages(orgId, formId),
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
    stages: getGroupPipelineStages(orgId),
  };
}

/** Two-stage timeline for the group pipeline:
 *    apply_at  → joined_at  → first_attend_at
 *  Each stage is computed independently, so the population for stage 2
 *  is "people who have BOTH a join date AND a first-attended date in
 *  the same group", not "people who completed stage 1 first". This is
 *  intentional — joined_at may be missing in PCO for older
 *  memberships, and dropping them from stage 2 would understate how
 *  fast joiners typically attend. */
function getGroupPipelineStages(orgId: number): PipelineStages {
  const db = getDb();

  const applyJoinRows = db
    .prepare(
      `WITH first_app AS (
         SELECT person_id, group_id, MIN(applied_at) AS first_app_at
           FROM pco_group_applications
          WHERE org_id = ?
            AND person_id IS NOT NULL
            AND group_id IS NOT NULL
            AND applied_at IS NOT NULL
          GROUP BY person_id, group_id
       ), first_join AS (
         SELECT person_id, group_id, MIN(joined_at) AS first_join_at
           FROM pco_group_memberships
          WHERE org_id = ?
            AND joined_at IS NOT NULL
          GROUP BY person_id, group_id
       )
       SELECT fa.first_app_at AS startAt, fj.first_join_at AS endAt
         FROM first_app fa
         JOIN first_join fj
           ON fj.person_id = fa.person_id
          AND fj.group_id = fa.group_id`,
    )
    .all(orgId, orgId) as Array<{ startAt: string; endAt: string }>;

  const joinAttendRows = db
    .prepare(
      `WITH first_join AS (
         SELECT person_id, group_id, MIN(joined_at) AS first_join_at
           FROM pco_group_memberships
          WHERE org_id = ?
            AND joined_at IS NOT NULL
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
       SELECT fj.first_join_at AS startAt, fa.first_att_at AS endAt
         FROM first_join fj
         JOIN first_att fa
           ON fa.person_id = fj.person_id
          AND fa.group_id = fj.group_id`,
    )
    .all(orgId, orgId) as Array<{ startAt: string; endAt: string }>;

  return {
    applyToJoin: statsFor(daysBetween(applyJoinRows)),
    joinToAttend: statsFor(daysBetween(joinAttendRows)),
  };
}

/** Two-stage timeline for the serving pipeline:
 *    form_sub  → first_scheduled  → first_actually_served
 *  Stage 1 ends when the person first appears on ANY plan_people
 *  record (any team). Stage 2 ends when the FIRST non-declined plan
 *  serve completes. Both stages are gated by the configured form id
 *  when one is set; otherwise the trigger falls back to "any form
 *  submission" same as the rollup. */
function getServingPipelineStages(
  orgId: number,
  servingInterestFormId: string | null,
): ServingPipelineStages {
  const db = getDb();
  const formId = servingInterestFormId ?? null;

  const triggerSelect = formId
    ? `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = base.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < base.first_at
          AND sub.form_id = ?`
    : `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = base.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < base.first_at`;

  // Stage 1: form sub → first scheduled (any status, including
  // declined — being scheduled IS the "added to the rotation" event).
  const stmtSchedule = db.prepare(
    `WITH base AS (
       SELECT pp.person_id, MIN(p.sort_date) AS first_at
         FROM pco_plan_people pp
         JOIN pco_plans p
           ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND p.sort_date IS NOT NULL
        GROUP BY pp.person_id
     )
     SELECT (${triggerSelect}) AS startAt, base.first_at AS endAt
       FROM base`,
  );
  const scheduleRows = (formId
    ? stmtSchedule.all(orgId, orgId, formId)
    : stmtSchedule.all(orgId, orgId)) as Array<{
    startAt: string | null;
    endAt: string;
  }>;

  // Stage 2: first scheduled → first actually served.
  const servedRows = db
    .prepare(
      `WITH first_sched AS (
         SELECT pp.person_id, MIN(p.sort_date) AS first_sched_at
           FROM pco_plan_people pp
           JOIN pco_plans p
             ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
          WHERE pp.org_id = ?
            AND pp.person_id != ''
            AND p.sort_date IS NOT NULL
          GROUP BY pp.person_id
       ), first_served AS (
         SELECT pp.person_id, MIN(p.sort_date) AS first_served_at
           FROM pco_plan_people pp
           JOIN pco_plans p
             ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
          WHERE pp.org_id = ?
            AND pp.person_id != ''
            AND p.sort_date IS NOT NULL
            AND lower(coalesce(pp.status, 'c')) NOT IN ('d', 'declined')
          GROUP BY pp.person_id
       )
       SELECT fs.first_sched_at AS startAt,
              srv.first_served_at AS endAt
         FROM first_sched fs
         JOIN first_served srv
           ON srv.person_id = fs.person_id`,
    )
    .all(orgId, orgId) as Array<{ startAt: string; endAt: string }>;

  return {
    formToSchedule: statsFor(daysBetween(scheduleRows)),
    scheduleToServe: statsFor(daysBetween(servedRows)),
  };
}

function daysBetween(
  rows: Array<{ startAt: string | null; endAt: string | null }>,
): number[] {
  const out: number[] = [];
  for (const r of rows) {
    if (!r.startAt || !r.endAt) continue;
    const days =
      (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) /
      MS_PER_DAY;
    if (!Number.isFinite(days) || days < 0 || days > PIPELINE_WINDOW_DAYS) {
      continue;
    }
    out.push(days);
  }
  return out;
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

// ─── Engagement scatter (do fast converters engage more deeply?) ──

export interface ConverterEngagement {
  /** Days from interest to action — the "convert speed" axis. */
  daysToConvert: number;
  /** 0-100 percentage of post-conversion events / plans they showed
   *  up for. */
  attendancePct: number;
  /** Calendar days between first and last post-conversion event. 0
   *  means they only attended once. */
  lifespanDays: number;
  /** Sample size denominator behind `attendancePct` — used to grey
   *  out points where the rate is based on too few data points to be
   *  meaningful. */
  eventsAvailable: number;
}

export interface EngagementSummary {
  points: ConverterEngagement[];
  /** Pearson correlation between daysToConvert and attendancePct.
   *  Negative = fast converters engage more (the "they care!"
   *  hypothesis). Null when fewer than 3 points. */
  correlation: number | null;
}

const ENGAGEMENT_MIN_EVENTS = 3;

/** For each person who completed the group pipeline (applied →
 *  attended in the same group), compute their post-join attendance
 *  rate within that group: events attended / events that happened in
 *  that group from their join date onward. Returns one row per
 *  (person, group) so a heavy joiner gets multiple data points if
 *  they're in multiple groups. */
export function getGroupConverterEngagement(
  orgId: number,
): EngagementSummary {
  const db = getDb();
  const rows = db
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
         SELECT person_id, group_id,
                MIN(event_starts_at) AS first_att_at,
                MAX(event_starts_at) AS last_att_at,
                SUM(CASE WHEN attended = 1 THEN 1 ELSE 0 END) AS attended_n
           FROM pco_event_attendances
          WHERE org_id = ?
            AND group_id IS NOT NULL
            AND event_starts_at IS NOT NULL
            AND attended = 1
          GROUP BY person_id, group_id
       )
       SELECT fa.person_id, fa.group_id,
              fa.first_app_at AS appliedAt,
              fatt.first_att_at AS firstAttAt,
              fatt.last_att_at AS lastAttAt,
              fatt.attended_n AS attendedN,
              (SELECT COUNT(*) FROM pco_group_events ge
                 WHERE ge.org_id = ?
                   AND ge.group_id = fa.group_id
                   AND ge.starts_at IS NOT NULL
                   AND ge.starts_at >= fatt.first_att_at) AS eventsAvailable
         FROM first_app fa
         JOIN first_att fatt
           ON fatt.person_id = fa.person_id
          AND fatt.group_id = fa.group_id`,
    )
    .all(orgId, orgId, orgId) as Array<{
    person_id: string;
    group_id: string;
    appliedAt: string;
    firstAttAt: string;
    lastAttAt: string;
    attendedN: number;
    eventsAvailable: number;
  }>;

  const points: ConverterEngagement[] = [];
  for (const r of rows) {
    const days =
      (new Date(r.firstAttAt).getTime() - new Date(r.appliedAt).getTime()) /
      MS_PER_DAY;
    if (!Number.isFinite(days) || days < 0 || days > PIPELINE_WINDOW_DAYS) {
      continue;
    }
    const denom = Math.max(r.eventsAvailable, r.attendedN);
    if (denom < ENGAGEMENT_MIN_EVENTS) continue;
    const lifespan =
      (new Date(r.lastAttAt).getTime() - new Date(r.firstAttAt).getTime()) /
      MS_PER_DAY;
    points.push({
      daysToConvert: days,
      attendancePct: Math.min(100, Math.round((r.attendedN / denom) * 100)),
      lifespanDays: Math.max(0, Math.round(lifespan)),
      eventsAvailable: denom,
    });
  }
  return { points, correlation: pearson(points) };
}

/** Serving analog: form sub → first served, then post-first-serve
 *  confirm rate (non-declined plan_people / total plan_people). */
export function getServingConverterEngagement(
  orgId: number,
  servingInterestFormId: string | null,
): EngagementSummary {
  const db = getDb();
  const formId = servingInterestFormId ?? null;
  const triggerSelect = formId
    ? `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = base.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < base.first_at
          AND sub.form_id = ?`
    : `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = base.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < base.first_at`;

  const stmt = db.prepare(
    `WITH base AS (
       SELECT pp.person_id, MIN(p.sort_date) AS first_at
         FROM pco_plan_people pp
         JOIN pco_plans p
           ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND p.sort_date IS NOT NULL
          AND lower(coalesce(pp.status, 'c')) NOT IN ('d', 'declined')
        GROUP BY pp.person_id
     ), counts AS (
       SELECT pp.person_id,
              SUM(CASE WHEN lower(coalesce(pp.status,'c')) NOT IN ('d','declined') THEN 1 ELSE 0 END) AS served_n,
              COUNT(*) AS scheduled_n,
              MAX(p.sort_date) AS last_at
         FROM pco_plan_people pp
         JOIN pco_plans p
           ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND p.sort_date IS NOT NULL
        GROUP BY pp.person_id
     )
     SELECT base.person_id,
            base.first_at AS firstAt,
            c.last_at AS lastAt,
            c.served_n AS servedN,
            c.scheduled_n AS scheduledN,
            (${triggerSelect}) AS startAt
       FROM base
       JOIN counts c ON c.person_id = base.person_id`,
  );

  const rows = (formId
    ? stmt.all(orgId, orgId, orgId, formId)
    : stmt.all(orgId, orgId, orgId)) as Array<{
    person_id: string;
    firstAt: string;
    lastAt: string;
    servedN: number;
    scheduledN: number;
    startAt: string | null;
  }>;

  const points: ConverterEngagement[] = [];
  for (const r of rows) {
    if (!r.startAt) continue;
    const days =
      (new Date(r.firstAt).getTime() - new Date(r.startAt).getTime()) /
      MS_PER_DAY;
    if (!Number.isFinite(days) || days < 0 || days > PIPELINE_WINDOW_DAYS) {
      continue;
    }
    if (r.scheduledN < ENGAGEMENT_MIN_EVENTS) continue;
    const lifespan =
      (new Date(r.lastAt).getTime() - new Date(r.firstAt).getTime()) /
      MS_PER_DAY;
    points.push({
      daysToConvert: days,
      attendancePct: Math.min(
        100,
        Math.round((r.servedN / r.scheduledN) * 100),
      ),
      lifespanDays: Math.max(0, Math.round(lifespan)),
      eventsAvailable: r.scheduledN,
    });
  }
  return { points, correlation: pearson(points) };
}

function pearson(points: ConverterEngagement[]): number | null {
  if (points.length < 3) return null;
  const n = points.length;
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0,
    syy = 0;
  for (const p of points) {
    const x = p.daysToConvert;
    const y = p.attendancePct;
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
    syy += y * y;
  }
  const num = n * sxy - sx * sy;
  const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (denom === 0) return null;
  return num / denom;
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
