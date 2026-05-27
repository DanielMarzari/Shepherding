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
  /** Form submission → first added to a team (PCO assignment created). */
  formToAdded: ConversionStats;
  /** Added to a team → first actually served (non-declined plan). */
  addedToServe: ConversionStats;
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
 *    form_sub  → first_added_to_team  → first_actually_served
 *  Stage 1 ends when the person is first added to ANY team in PCO
 *  (pco_team_memberships.pco_created_at — sourced from PCO's
 *  person_team_position_assignments.created_at). Stage 2 ends when
 *  they first serve on a non-declined plan. Both stages are gated by
 *  the configured form id when one is set; otherwise the trigger
 *  falls back to "any form submission". */
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

  // Stage 1: form sub → first added to any team.
  const stmtAdded = db.prepare(
    `WITH base AS (
       SELECT person_id, MIN(pco_created_at) AS first_at
         FROM pco_team_memberships
        WHERE org_id = ?
          AND person_id != ''
          AND pco_created_at IS NOT NULL
        GROUP BY person_id
     )
     SELECT (${triggerSelect}) AS startAt, base.first_at AS endAt
       FROM base`,
  );
  const addedRows = (formId
    ? stmtAdded.all(orgId, orgId, formId)
    : stmtAdded.all(orgId, orgId)) as Array<{
    startAt: string | null;
    endAt: string;
  }>;

  // Stage 2: first added to team → first actually served.
  const servedRows = db
    .prepare(
      `WITH first_added AS (
         SELECT person_id, MIN(pco_created_at) AS first_added_at
           FROM pco_team_memberships
          WHERE org_id = ?
            AND person_id != ''
            AND pco_created_at IS NOT NULL
          GROUP BY person_id
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
       SELECT fa.first_added_at AS startAt,
              srv.first_served_at AS endAt
         FROM first_added fa
         JOIN first_served srv ON srv.person_id = fa.person_id`,
    )
    .all(orgId, orgId) as Array<{ startAt: string; endAt: string }>;

  return {
    formToAdded: statsFor(daysBetween(addedRows)),
    addedToServe: statsFor(daysBetween(servedRows)),
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

// ─── Per-person 3-milestone view (apply, added, attended) ────────

export interface StagePoint {
  /** Stage 1 days: apply → join (groups) or form → scheduled (serving). */
  stage1: number;
  /** Stage 2 days: join → attend (groups) or scheduled → first served (serving). */
  stage2: number;
  /** Sum — used to render dot size so the eye sees worst-cases pop. */
  total: number;
  /** Short label for the hover tooltip (group / team name). */
  label: string;
}

/** Per-person points showing BOTH waits for everyone who completed
 *  the full group pipeline. Each row is one (person, group) — a heavy
 *  joiner in 3 groups gives 3 points so per-group patterns surface. */
export function getGroupStagePoints(orgId: number): StagePoint[] {
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
       ), first_join AS (
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
       SELECT fa.first_app_at AS appliedAt,
              fj.first_join_at AS joinedAt,
              fatt.first_att_at AS attendedAt,
              g.name AS groupName
         FROM first_app fa
         JOIN first_join fj
           ON fj.person_id = fa.person_id AND fj.group_id = fa.group_id
         JOIN first_att fatt
           ON fatt.person_id = fa.person_id
          AND fatt.group_id = fa.group_id
         LEFT JOIN pco_groups g
           ON g.org_id = ? AND g.pco_id = fa.group_id`,
    )
    .all(orgId, orgId, orgId, orgId) as Array<{
    appliedAt: string;
    joinedAt: string;
    attendedAt: string;
    groupName: string | null;
  }>;
  return buildStagePoints(rows.map((r) => ({
    startAt: r.appliedAt,
    midAt: r.joinedAt,
    endAt: r.attendedAt,
    label: r.groupName ?? "(unnamed group)",
  })));
}

/** Serving analog. Stage 1 = form sub → first added to a team
 *  (pco_team_memberships.pco_created_at). Stage 2 = added → first
 *  non-declined plan they served. One row per (person, team) so per-
 *  team patterns surface in the scatter shape — a person added to 3
 *  teams gives 3 dots. */
export function getServingStagePoints(
  orgId: number,
  servingInterestFormId: string | null,
): StagePoint[] {
  const db = getDb();
  const formId = servingInterestFormId ?? null;
  const triggerSelect = formId
    ? `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = milestones.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < milestones.added_at
          AND sub.form_id = ?`
    : `SELECT MAX(sub.pco_created_at)
         FROM pco_form_submissions sub
        WHERE sub.org_id = ? AND sub.person_id = milestones.person_id
          AND sub.pco_created_at IS NOT NULL
          AND sub.pco_created_at < milestones.added_at`;

  const stmt = db.prepare(
    `WITH first_added AS (
       SELECT person_id, team_id, MIN(pco_created_at) AS added_at
         FROM pco_team_memberships
        WHERE org_id = ?
          AND person_id != ''
          AND pco_created_at IS NOT NULL
        GROUP BY person_id, team_id
     ), first_served_team AS (
       SELECT pp.person_id, pp.team_id, MIN(p.sort_date) AS first_served_at
         FROM pco_plan_people pp
         JOIN pco_plans p
           ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND pp.team_id IS NOT NULL
          AND p.sort_date IS NOT NULL
          AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
        GROUP BY pp.person_id, pp.team_id
     ), milestones AS (
       SELECT fa.person_id, fa.team_id, fa.added_at,
              srv.first_served_at AS served_at
         FROM first_added fa
         JOIN first_served_team srv
           ON srv.person_id = fa.person_id
          AND srv.team_id = fa.team_id
     )
     SELECT (${triggerSelect}) AS appliedAt,
            milestones.added_at AS addedAt,
            milestones.served_at AS servedAt,
            t.name AS teamName
       FROM milestones
       LEFT JOIN pco_teams t
         ON t.org_id = ? AND t.pco_id = milestones.team_id`,
  );
  const rows = (formId
    ? stmt.all(orgId, orgId, orgId, formId, orgId)
    : stmt.all(orgId, orgId, orgId, orgId)) as Array<{
    appliedAt: string | null;
    addedAt: string;
    servedAt: string;
    teamName: string | null;
  }>;
  return buildStagePoints(rows.map((r) => ({
    startAt: r.appliedAt,
    midAt: r.addedAt,
    endAt: r.servedAt,
    label: r.teamName ?? "(unknown team)",
  })));
}

function buildStagePoints(
  rows: Array<{
    startAt: string | null;
    midAt: string | null;
    endAt: string | null;
    label: string;
  }>,
): StagePoint[] {
  const out: StagePoint[] = [];
  for (const r of rows) {
    if (!r.startAt || !r.midAt || !r.endAt) continue;
    const t1 = new Date(r.startAt).getTime();
    const t2 = new Date(r.midAt).getTime();
    const t3 = new Date(r.endAt).getTime();
    const s1 = (t2 - t1) / MS_PER_DAY;
    const s2 = (t3 - t2) / MS_PER_DAY;
    if (
      !Number.isFinite(s1) ||
      !Number.isFinite(s2) ||
      s1 < 0 ||
      s2 < 0 ||
      s1 > PIPELINE_WINDOW_DAYS ||
      s2 > PIPELINE_WINDOW_DAYS
    ) {
      continue;
    }
    out.push({
      stage1: Math.round(s1 * 10) / 10,
      stage2: Math.round(s2 * 10) / 10,
      total: Math.round(s1 + s2),
      label: r.label,
    });
  }
  return out;
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

/** For each person who completed the group pipeline, compute their
 *  post-first-attendance attendance rate within that group: the same
 *  pco_event_attendances table provides BOTH the numerator (rows with
 *  attended=1) and the denominator (rows total, attended or not) —
 *  using it as both sides guarantees denom ≥ numer, so the percentage
 *  is mathematically bounded ≤ 100% by construction.
 *
 *  The earlier version used pco_group_events for the denominator and
 *  pco_event_attendances for the numerator; if PCO had recorded
 *  attendance for an event we hadn't synced into pco_group_events,
 *  attendedN could exceed eventsAvailable and the calculation went
 *  above 100% (this is what produced the "112%" cases). */
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
                MIN(event_starts_at) AS first_att_at
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
              -- Numerator: how many of this person's attendance rows
              --   in this group, from their first attendance onward,
              --   actually recorded attended=1.
              (SELECT COUNT(*) FROM pco_event_attendances a
                 WHERE a.org_id = ? AND a.person_id = fa.person_id
                   AND a.group_id = fa.group_id
                   AND a.attended = 1
                   AND a.event_starts_at IS NOT NULL
                   AND a.event_starts_at >= fatt.first_att_at) AS attendedN,
              -- Denominator: total attendance rows in the same window
              --   (attended or not). Always ≥ attendedN by construction.
              (SELECT COUNT(*) FROM pco_event_attendances a
                 WHERE a.org_id = ? AND a.person_id = fa.person_id
                   AND a.group_id = fa.group_id
                   AND a.event_starts_at IS NOT NULL
                   AND a.event_starts_at >= fatt.first_att_at) AS recordedN,
              -- Lifespan: their last attended event in this group.
              (SELECT MAX(a.event_starts_at) FROM pco_event_attendances a
                 WHERE a.org_id = ? AND a.person_id = fa.person_id
                   AND a.group_id = fa.group_id
                   AND a.attended = 1) AS lastAttAt
         FROM first_app fa
         JOIN first_att fatt
           ON fatt.person_id = fa.person_id
          AND fatt.group_id = fa.group_id`,
    )
    .all(orgId, orgId, orgId, orgId, orgId) as Array<{
    person_id: string;
    group_id: string;
    appliedAt: string;
    firstAttAt: string;
    lastAttAt: string;
    attendedN: number;
    recordedN: number;
  }>;

  const points: ConverterEngagement[] = [];
  for (const r of rows) {
    const days =
      (new Date(r.firstAttAt).getTime() - new Date(r.appliedAt).getTime()) /
      MS_PER_DAY;
    if (!Number.isFinite(days) || days < 0 || days > PIPELINE_WINDOW_DAYS) {
      continue;
    }
    // recordedN is guaranteed ≥ attendedN since attendedN is a strict
    // subset of the same query universe. Min event floor stays so we
    // don't render meaningless dots from a single data point.
    if (r.recordedN < ENGAGEMENT_MIN_EVENTS) continue;
    const ratio = r.attendedN / r.recordedN;
    const lifespan =
      (new Date(r.lastAttAt).getTime() - new Date(r.firstAttAt).getTime()) /
      MS_PER_DAY;
    points.push({
      daysToConvert: days,
      attendancePct: Math.min(100, Math.max(0, Math.round(ratio * 100))),
      lifespanDays: Math.max(0, Math.round(lifespan)),
      eventsAvailable: r.recordedN,
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
