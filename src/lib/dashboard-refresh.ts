import "server-only";
import { getDb } from "./db";
import { getSyncSettings } from "./pco";

const MS_PER_DAY = 86_400_000;
const MS_PER_MONTH = 30 * MS_PER_DAY;

/** Progress callback invoked between each refresh phase. Called with
 *  the 1-indexed step number, total step count, and a human-readable
 *  label for the step that JUST finished (so a value of step=2 means
 *  steps 1 and 2 are done). */
export type RefreshProgressCallback = (
  step: number,
  total: number,
  label: string,
) => void;

const REFRESH_PHASES: Array<{
  label: string;
  run: (
    orgId: number,
    ctx: { cutoffActivity: string; cutoff30: string; activityMonths: number },
  ) => void;
}> = [
  {
    label: "Computing per-person activity rollup",
    run: (orgId, ctx) => rebuildPersonActivity(orgId, ctx.cutoffActivity),
  },
  {
    label: "Classifying people",
    run: (orgId, ctx) => classifyPersonActivity(orgId, ctx.cutoffActivity),
  },
  {
    label: "Summarizing groups",
    run: (orgId, ctx) =>
      rebuildGroupSummary(orgId, ctx.activityMonths, ctx.cutoff30),
  },
  {
    label: "Aggregating org totals",
    run: (orgId, ctx) => rebuildOrgSnapshot(orgId, ctx.activityMonths),
  },
];

export const REFRESH_TOTAL_STEPS = REFRESH_PHASES.length;

/** Rebuild every dashboard / lanes / home summary table for an org
 *  from scratch. Each phase commits independently so a progress
 *  callback between phases can write status that other DB readers
 *  can actually see (a single wrapping transaction would hide all
 *  progress writes until the very end).
 *
 *  This sacrifices cross-phase atomicity — a crash mid-refresh
 *  leaves the snapshot half-old half-new — in exchange for a
 *  usable progress bar. Acceptable because the data is derived;
 *  re-running fixes it. */
export function refreshDashboardSnapshots(
  orgId: number,
  onProgress?: RefreshProgressCallback,
): void {
  const db = getDb();
  const settings = getSyncSettings(orgId);
  const activityMonths = settings.activityMonths;
  const ctx = {
    cutoffActivity: new Date(
      Date.now() - activityMonths * MS_PER_MONTH,
    ).toISOString(),
    cutoff30: new Date(Date.now() - 30 * MS_PER_DAY).toISOString(),
    activityMonths,
  };
  for (let i = 0; i < REFRESH_PHASES.length; i++) {
    const phase = REFRESH_PHASES[i];
    db.transaction(() => phase.run(orgId, ctx))();
    onProgress?.(i + 1, REFRESH_PHASES.length, phase.label);
  }
}

// ─── Background-run tracking (for the progress-bar UI) ───────────

export interface RefreshRunStatus {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "error";
  currentStep: number;
  totalSteps: number;
  stepLabel: string | null;
  error: string | null;
  /** Wall-clock ms elapsed so far. Useful for the "1.4s" tail label. */
  elapsedMs: number;
}

/** Module-level promise set: keeps the in-flight refresh promise
 *  alive across server-action ticks so V8 doesn't GC it. The DB row
 *  is the source of truth for clients polling status. */
const inFlightRefreshes = new Set<Promise<unknown>>();

export function createRefreshRun(orgId: number): number {
  const result = getDb()
    .prepare(
      `INSERT INTO dashboard_refresh_runs
         (org_id, status, current_step, total_steps, step_label)
       VALUES (?, 'running', 0, ?, ?)`,
    )
    .run(orgId, REFRESH_TOTAL_STEPS, "Starting…");
  return Number(result.lastInsertRowid);
}

function updateRefreshProgress(
  runId: number,
  step: number,
  label: string,
): void {
  getDb()
    .prepare(
      `UPDATE dashboard_refresh_runs
          SET current_step = ?, step_label = ?
        WHERE id = ?`,
    )
    .run(step, label, runId);
}

function finishRefreshRun(
  runId: number,
  status: "ok" | "error",
  error: string | null,
): void {
  getDb()
    .prepare(
      `UPDATE dashboard_refresh_runs
          SET status = ?, error = ?,
              finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
    )
    .run(status, error, runId);
}

/** Fire-and-forget a refresh, return the run id immediately. The
 *  client polls status via getRefreshRunStatus. */
export function startRefreshInBackground(orgId: number): number {
  const runId = createRefreshRun(orgId);
  const promise = (async () => {
    try {
      refreshDashboardSnapshots(orgId, (step, _total, label) => {
        updateRefreshProgress(runId, step, label);
      });
      finishRefreshRun(runId, "ok", null);
    } catch (e) {
      finishRefreshRun(runId, "error", e instanceof Error ? e.message : String(e));
    }
  })();
  inFlightRefreshes.add(promise);
  promise.finally(() => inFlightRefreshes.delete(promise));
  return runId;
}

export function getRefreshRunStatus(runId: number): RefreshRunStatus | null {
  const row = getDb()
    .prepare(
      `SELECT id, started_at, finished_at, status, current_step,
              total_steps, step_label, error
         FROM dashboard_refresh_runs
        WHERE id = ?`,
    )
    .get(runId) as
    | {
        id: number;
        started_at: string;
        finished_at: string | null;
        status: "running" | "ok" | "error";
        current_step: number;
        total_steps: number;
        step_label: string | null;
        error: string | null;
      }
    | undefined;
  if (!row) return null;
  const startedMs = new Date(row.started_at).getTime();
  const endMs = row.finished_at
    ? new Date(row.finished_at).getTime()
    : Date.now();
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    currentStep: row.current_step,
    totalSteps: row.total_steps,
    stepLabel: row.step_label,
    error: row.error,
    elapsedMs: Math.max(0, endMs - startedMs),
  };
}

function rebuildPersonActivity(
  orgId: number,
  cutoffActivity: string,
): void {
  const db = getDb();
  // Wipe + repopulate. Cheaper than a per-row UPSERT pass when the
  // whole table is being rewritten anyway.
  db.prepare(`DELETE FROM person_activity WHERE org_id = ?`).run(orgId);
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO person_activity
       (org_id, person_id,
        last_form_at, last_check_in_at, last_attended_at, last_served_at,
        last_pco_updated_at, last_activity_at,
        active_group_count, active_team_count,
        in_lane_wors, in_lane_comm, in_lane_serv,
        first_comm_at, first_serv_at,
        classification)
     SELECT
       ?,
       p.pco_id,
       p.last_form_submission_at,
       p.last_check_in_at,
       (SELECT MAX(event_starts_at) FROM pco_event_attendances a
         WHERE a.org_id = p.org_id AND a.person_id = p.pco_id
           AND a.attended = 1 AND a.event_starts_at IS NOT NULL
           AND a.event_starts_at <= ?),
       (SELECT MAX(pl.sort_date) FROM pco_plan_people pp
         JOIN pco_plans pl
           ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
        WHERE pp.org_id = p.org_id AND pp.person_id = p.pco_id
          AND pl.sort_date IS NOT NULL
          AND pl.sort_date <= ?
          AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')),
       p.pco_updated_at,
       -- last_activity_at = max across all sources (no futures)
       (SELECT MAX(d) FROM (
          SELECT p.last_form_submission_at AS d
           WHERE p.last_form_submission_at IS NOT NULL
             AND p.last_form_submission_at <= ?
          UNION ALL
          SELECT p.last_check_in_at
           WHERE p.last_check_in_at IS NOT NULL
             AND p.last_check_in_at <= ?
          UNION ALL
          SELECT p.pco_updated_at
           WHERE p.pco_updated_at IS NOT NULL
             AND p.pco_updated_at <= ?
          UNION ALL
          SELECT MAX(a.event_starts_at) FROM pco_event_attendances a
           WHERE a.org_id = p.org_id AND a.person_id = p.pco_id
             AND a.attended = 1 AND a.event_starts_at <= ?
          UNION ALL
          SELECT MAX(pl.sort_date) FROM pco_plan_people pp
            JOIN pco_plans pl
              ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
           WHERE pp.org_id = p.org_id AND pp.person_id = p.pco_id
             AND pl.sort_date <= ?
             AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
        )),
       (SELECT COUNT(*) FROM pco_group_memberships gm
         WHERE gm.org_id = p.org_id AND gm.person_id = p.pco_id
           AND gm.archived_at IS NULL),
       (SELECT COUNT(*) FROM pco_team_memberships tm
         WHERE tm.org_id = p.org_id AND tm.person_id = p.pco_id
           AND tm.archived_at IS NULL),
       -- in_lane_wors: attended a group event OR served on a plan in the window
       CASE WHEN EXISTS (
         SELECT 1 FROM pco_event_attendances a
          WHERE a.org_id = p.org_id AND a.person_id = p.pco_id
            AND a.attended = 1 AND a.event_starts_at >= ?
       ) OR EXISTS (
         SELECT 1 FROM pco_plan_people pp
           JOIN pco_plans pl
             ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
          WHERE pp.org_id = p.org_id AND pp.person_id = p.pco_id
            AND pl.sort_date >= ?
            AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
       ) THEN 1 ELSE 0 END,
       -- in_lane_comm: any active group membership
       CASE WHEN EXISTS (
         SELECT 1 FROM pco_group_memberships gm
          WHERE gm.org_id = p.org_id AND gm.person_id = p.pco_id
            AND gm.archived_at IS NULL
       ) THEN 1 ELSE 0 END,
       -- in_lane_serv: any active team membership
       CASE WHEN EXISTS (
         SELECT 1 FROM pco_team_memberships tm
          WHERE tm.org_id = p.org_id AND tm.person_id = p.pco_id
            AND tm.archived_at IS NULL
       ) THEN 1 ELSE 0 END,
       -- first_comm_at: earliest joined-a-group date (ever, including
       -- archived memberships — we want to know when they first
       -- entered the lane, not whether they're still in it).
       (SELECT MIN(joined_at) FROM pco_group_memberships gm
         WHERE gm.org_id = p.org_id AND gm.person_id = p.pco_id
           AND gm.joined_at IS NOT NULL AND gm.joined_at <= ?),
       -- first_serv_at: earliest team-add date (PCO created_at on
       -- person_team_position_assignments — captured into
       -- pco_team_memberships.pco_created_at by the services sync).
       (SELECT MIN(pco_created_at) FROM pco_team_memberships tm
         WHERE tm.org_id = p.org_id AND tm.person_id = p.pco_id
           AND tm.pco_created_at IS NOT NULL AND tm.pco_created_at <= ?),
       NULL  -- classification filled in by a second pass below
     FROM pco_people p
     WHERE p.org_id = ?`,
  ).run(
    orgId,
    nowIso, nowIso, // attended / served upper bounds
    nowIso, nowIso, nowIso, nowIso, nowIso, // last_activity max sub-queries
    cutoffActivity, cutoffActivity, // in_lane_wors cutoffs
    nowIso, nowIso, // first_comm_at / first_serv_at upper bounds
    orgId,
  );

}

/** Second pass on person_activity that fills in the classification
 *  using the same priority rule as people-read.ts (shepherded >
 *  active > present > inactive). Kept separate from the insert so
 *  the refresh progress bar can report it as its own step. */
function classifyPersonActivity(orgId: number, cutoffActivity: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE person_activity
        SET classification = CASE
              WHEN active_group_count > 0 OR active_team_count > 0
                   THEN 'shepherded'
              WHEN (last_form_at IS NOT NULL AND last_form_at >= ?)
                OR (last_check_in_at IS NOT NULL AND last_check_in_at >= ?)
                   THEN 'active'
              WHEN (last_pco_updated_at IS NOT NULL AND last_pco_updated_at >= ?)
                   THEN 'present'
              ELSE 'inactive'
            END,
            refreshed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE org_id = ?`,
  ).run(cutoffActivity, cutoffActivity, cutoffActivity, orgId);
}

function rebuildGroupSummary(
  orgId: number,
  activityMonths: number,
  cutoff30: string,
): void {
  const db = getDb();
  const trackingCutoff = new Date(
    Date.now() - activityMonths * MS_PER_MONTH,
  ).toISOString();
  db.prepare(`DELETE FROM group_summary WHERE org_id = ?`).run(orgId);
  db.prepare(
    `INSERT INTO group_summary
       (org_id, group_id, members, leaders, joined_30d, left_30d,
        attended_distinct_window, events_window, attendance_pct, state)
     SELECT
       g.org_id,
       g.pco_id,
       coalesce(mpg.members, 0),
       coalesce(mpg.leaders, 0),
       coalesce(mpg.joined_30d, 0),
       coalesce(mpg.left_30d, 0),
       coalesce(apg.attended_distinct_window, 0),
       coalesce(epg.events_window, 0),
       CASE
         WHEN coalesce(mpg.members, 0) = 0
           OR coalesce(apg.attended_distinct_window, 0) = 0
              THEN NULL
         ELSE MIN(100, (apg.attended_distinct_window * 100.0) / mpg.members)
       END,
       CASE
         WHEN g.archived_at IS NOT NULL                          THEN 'paused'
         WHEN coalesce(epg.events_window, 0) = 0
          AND coalesce(mpg.members, 0) > 0                       THEN 'paused'
         WHEN coalesce(mpg.joined_30d, 0)
            - coalesce(mpg.left_30d, 0) >= 2                     THEN 'growing'
         WHEN coalesce(mpg.joined_30d, 0)
            - coalesce(mpg.left_30d, 0) <= -2                    THEN 'shrinking'
         ELSE 'steady'
       END
     FROM pco_groups g
     LEFT JOIN (
       SELECT group_id,
              SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS members,
              SUM(CASE WHEN archived_at IS NULL
                        AND lower(coalesce(role,'')) LIKE '%leader%'
                       THEN 1 ELSE 0 END) AS leaders,
              SUM(CASE WHEN archived_at IS NULL
                        AND joined_at IS NOT NULL AND joined_at >= ?
                       THEN 1 ELSE 0 END) AS joined_30d,
              SUM(CASE WHEN archived_at IS NOT NULL AND archived_at >= ?
                       THEN 1 ELSE 0 END) AS left_30d
         FROM pco_group_memberships
        WHERE org_id = ?
        GROUP BY group_id
     ) mpg ON mpg.group_id = g.pco_id
     LEFT JOIN (
       SELECT group_id,
              COUNT(DISTINCT person_id) AS attended_distinct_window
         FROM pco_event_attendances
        WHERE org_id = ? AND attended = 1 AND event_starts_at >= ?
        GROUP BY group_id
     ) apg ON apg.group_id = g.pco_id
     LEFT JOIN (
       SELECT group_id,
              COUNT(*) AS events_window
         FROM pco_group_events
        WHERE org_id = ? AND starts_at IS NOT NULL AND starts_at >= ?
        GROUP BY group_id
     ) epg ON epg.group_id = g.pco_id
     WHERE g.org_id = ?`,
  ).run(
    cutoff30,
    cutoff30,
    orgId,
    orgId,
    trackingCutoff,
    orgId,
    trackingCutoff,
    orgId,
  );
}

function rebuildOrgSnapshot(orgId: number, activityMonths: number): void {
  const db = getDb();
  const cutoff30 = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
  // Totals roll up from person_activity (which we just rebuilt).
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN classification = 'shepherded' THEN 1 ELSE 0 END) AS shepherded,
         SUM(CASE WHEN classification = 'active'     THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN classification = 'present'    THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN classification = 'inactive'   THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN active_group_count = 0
                   AND active_team_count = 0
                  THEN 1 ELSE 0 END) AS unshepherded,
         SUM(in_lane_wors) AS lane_wors,
         SUM(in_lane_comm) AS lane_comm,
         SUM(in_lane_serv) AS lane_serv,
         SUM(CASE WHEN in_lane_wors = 0 AND in_lane_comm = 0
                   AND in_lane_serv = 0
                  THEN 1 ELSE 0 END) AS lane_none
       FROM person_activity
       WHERE org_id = ?`,
    )
    .get(orgId) as {
    total: number;
    shepherded: number;
    active: number;
    present: number;
    inactive: number;
    unshepherded: number;
    lane_wors: number;
    lane_comm: number;
    lane_serv: number;
    lane_none: number;
  };

  // Joined/departed in last 30 days — still computed from raw tables
  // because they're cross-cutting across groups + teams (not strictly
  // per-person). Two cheap indexed range scans.
  const joined30 = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT person_id FROM pco_group_memberships
            WHERE org_id = ? AND joined_at IS NOT NULL AND joined_at >= ?
           UNION
           SELECT DISTINCT person_id FROM pco_team_memberships
            WHERE org_id = ? AND person_id != ''
              AND pco_created_at IS NOT NULL AND pco_created_at >= ?
         )`,
      )
      .get(orgId, cutoff30, orgId, cutoff30) as { n: number } | undefined
  )?.n ?? 0;

  const departed30 = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT person_id FROM pco_group_memberships
            WHERE org_id = ? AND archived_at IS NOT NULL AND archived_at >= ?
           UNION
           SELECT DISTINCT person_id FROM pco_team_memberships
            WHERE org_id = ? AND person_id != ''
              AND archived_at IS NOT NULL AND archived_at >= ?
         )`,
      )
      .get(orgId, cutoff30, orgId, cutoff30) as { n: number } | undefined
  )?.n ?? 0;

  db.prepare(
    `INSERT INTO org_snapshot
       (org_id, total_people, shepherded_count, active_count, present_count,
        inactive_count, unshepherded_count, joined_30d, departed_30d,
        lane_wors, lane_comm, lane_serv, lane_none, activity_months,
        refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id) DO UPDATE SET
       total_people = excluded.total_people,
       shepherded_count = excluded.shepherded_count,
       active_count = excluded.active_count,
       present_count = excluded.present_count,
       inactive_count = excluded.inactive_count,
       unshepherded_count = excluded.unshepherded_count,
       joined_30d = excluded.joined_30d,
       departed_30d = excluded.departed_30d,
       lane_wors = excluded.lane_wors,
       lane_comm = excluded.lane_comm,
       lane_serv = excluded.lane_serv,
       lane_none = excluded.lane_none,
       activity_months = excluded.activity_months,
       refreshed_at = excluded.refreshed_at`,
  ).run(
    orgId,
    counts.total,
    counts.shepherded,
    counts.active,
    counts.present,
    counts.inactive,
    counts.unshepherded,
    joined30,
    departed30,
    counts.lane_wors,
    counts.lane_comm,
    counts.lane_serv,
    counts.lane_none,
    activityMonths,
  );
}

// ─── Read helpers ─────────────────────────────────────────────────

export interface OrgSnapshot {
  totalPeople: number;
  shepherdedCount: number;
  activeCount: number;
  presentCount: number;
  inactiveCount: number;
  unshepherdedCount: number;
  joined30d: number;
  departed30d: number;
  laneWors: number;
  laneComm: number;
  laneServ: number;
  laneNone: number;
  activityMonths: number;
  refreshedAt: string;
}

// ─── Lane flow (for the /lanes sankey) ────────────────────────────

/** Lane category for the sankey. We deliberately only model the lanes
 *  we can actually measure right now — community (groups) and serving
 *  (teams). Worship needs Sunday check-in to be reliable and most
 *  churches don't require it; giving needs PCO Giving sync. Both stay
 *  out of the chart until we can capture them honestly. */
export type LaneCategory = "comm" | "serv" | "both" | "none";

export interface LaneFlow {
  /** Flow rows: how many people started in `from` and currently sit
   *  in `to`. Sums per `from` equal the total population. */
  flows: Array<{ from: LaneCategory; to: LaneCategory; count: number }>;
  /** Per-source totals — used to size the left-column rectangles. */
  fromTotals: Record<LaneCategory, number>;
  /** Per-destination totals — sizes the right-column rectangles. */
  toTotals: Record<LaneCategory, number>;
  /** Total people considered (everyone in the org). */
  total: number;
}

/** People bucketed by "first lane entered" × "currently in lane". Reads
 *  entirely from person_activity so the sankey rebuild is a single
 *  table scan. Two people who entered both lanes within 30 days of
 *  each other are classified as "both" on the entry side. */
export function getLaneFlow(orgId: number): LaneFlow {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT first_comm_at, first_serv_at,
              active_group_count, active_team_count
         FROM person_activity
        WHERE org_id = ?`,
    )
    .all(orgId) as Array<{
    first_comm_at: string | null;
    first_serv_at: string | null;
    active_group_count: number;
    active_team_count: number;
  }>;

  const SAME_TIME_MS = 30 * 86_400_000;
  const buckets: Record<string, number> = {};
  const fromTotals: Record<LaneCategory, number> = {
    comm: 0,
    serv: 0,
    both: 0,
    none: 0,
  };
  const toTotals: Record<LaneCategory, number> = {
    comm: 0,
    serv: 0,
    both: 0,
    none: 0,
  };

  function bucketKey(from: LaneCategory, to: LaneCategory): string {
    return `${from}>${to}`;
  }

  for (const r of rows) {
    let from: LaneCategory;
    if (!r.first_comm_at && !r.first_serv_at) {
      from = "none";
    } else if (r.first_comm_at && !r.first_serv_at) {
      from = "comm";
    } else if (r.first_serv_at && !r.first_comm_at) {
      from = "serv";
    } else {
      const dComm = new Date(r.first_comm_at!).getTime();
      const dServ = new Date(r.first_serv_at!).getTime();
      from =
        Math.abs(dComm - dServ) <= SAME_TIME_MS
          ? "both"
          : dComm < dServ
            ? "comm"
            : "serv";
    }

    let to: LaneCategory;
    if (r.active_group_count > 0 && r.active_team_count > 0) to = "both";
    else if (r.active_group_count > 0) to = "comm";
    else if (r.active_team_count > 0) to = "serv";
    else to = "none";

    fromTotals[from]++;
    toTotals[to]++;
    const k = bucketKey(from, to);
    buckets[k] = (buckets[k] ?? 0) + 1;
  }

  const flows: LaneFlow["flows"] = [];
  for (const k of Object.keys(buckets)) {
    const [from, to] = k.split(">") as [LaneCategory, LaneCategory];
    flows.push({ from, to, count: buckets[k] });
  }
  return {
    flows,
    fromTotals,
    toTotals,
    total: rows.length,
  };
}

/** Returns NULL when no snapshot has ever been computed for the org.
 *  Read paths fall back to live computation in that case so the page
 *  still works on a fresh install — just slower. */
export function getOrgSnapshot(orgId: number): OrgSnapshot | null {
  const row = getDb()
    .prepare(
      `SELECT total_people AS totalPeople,
              shepherded_count AS shepherdedCount,
              active_count AS activeCount,
              present_count AS presentCount,
              inactive_count AS inactiveCount,
              unshepherded_count AS unshepherdedCount,
              joined_30d AS joined30d,
              departed_30d AS departed30d,
              lane_wors AS laneWors,
              lane_comm AS laneComm,
              lane_serv AS laneServ,
              lane_none AS laneNone,
              activity_months AS activityMonths,
              refreshed_at AS refreshedAt
         FROM org_snapshot WHERE org_id = ?`,
    )
    .get(orgId) as OrgSnapshot | undefined;
  return row ?? null;
}
