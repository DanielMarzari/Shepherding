import "server-only";
import { getDb } from "./db";
import { getExcludedMembershipTypes, getSyncSettings } from "./pco";
import { populateShepherdedTempTable } from "./people-read";

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
  {
    label: "Computing lane transitions",
    run: (orgId) => rebuildLaneTransitions(orgId),
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

const yieldTick = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

/** Same work as refreshDashboardSnapshots but yields to the event
 *  loop between phases AND inside the slow phases. Critical because
 *  better-sqlite3 is synchronous + we only have one DB connection +
 *  Node is single-threaded: any sync work blocks every other HTTP
 *  request to this worker, including page renders for the home page.
 *
 *  The async-aware versions of each phase (rebuildPersonActivityAsync,
 *  rebuildGroupSummaryAsync) yield after every individual statement
 *  rather than wrapping the phase in one big transaction, so other
 *  requests interleave between statements and the server stays
 *  responsive throughout the refresh. Inconsistent intermediate
 *  states (e.g. between DELETE and INSERT on person_activity) are
 *  bounded — see the staging-table dance inside each phase. */
export async function refreshDashboardSnapshotsAsync(
  orgId: number,
  onProgress?: RefreshProgressCallback,
): Promise<void> {
  const settings = getSyncSettings(orgId);
  const activityMonths = settings.activityMonths;
  const cutoffActivity = new Date(
    Date.now() - activityMonths * MS_PER_MONTH,
  ).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();

  await rebuildPersonActivityAsync(orgId, cutoffActivity);
  onProgress?.(1, REFRESH_TOTAL_STEPS, REFRESH_PHASES[0].label);
  await yieldTick();

  classifyPersonActivity(orgId, cutoffActivity);
  onProgress?.(2, REFRESH_TOTAL_STEPS, REFRESH_PHASES[1].label);
  await yieldTick();

  await rebuildGroupSummaryAsync(orgId, activityMonths, cutoff30);
  onProgress?.(3, REFRESH_TOTAL_STEPS, REFRESH_PHASES[2].label);
  await yieldTick();

  rebuildOrgSnapshot(orgId, activityMonths);
  onProgress?.(4, REFRESH_TOTAL_STEPS, REFRESH_PHASES[3].label);
  await yieldTick();

  rebuildLaneTransitions(orgId);
  onProgress?.(5, REFRESH_TOTAL_STEPS, REFRESH_PHASES[4].label);
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

/** Abandon a running refresh — marks the row as error so the UI
 *  unblocks immediately. We can't actually kill the background work
 *  (better-sqlite3 is synchronous; once a phase starts there's no
 *  abort token to flip), but the abandoned work just keeps writing
 *  to the snapshot tables in the background, and the next refresh
 *  the user starts will overwrite those tables anyway. Safe. */
export function abandonRefreshRun(runId: number): void {
  getDb()
    .prepare(
      `UPDATE dashboard_refresh_runs
          SET status = 'error',
              error = 'Abandoned by user — background work may still finish silently.',
              finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND status = 'running'`,
    )
    .run(runId);
}

/** Most-recent run for this org, regardless of status — used by the
 *  home page so we can show a "still going" banner across page
 *  reloads (rather than only showing the banner when the user's
 *  current tab triggered it). */
export function getLatestRefreshRunForOrg(
  orgId: number,
): RefreshRunStatus | null {
  const row = getDb()
    .prepare(
      `SELECT id FROM dashboard_refresh_runs
        WHERE org_id = ?
        ORDER BY started_at DESC LIMIT 1`,
    )
    .get(orgId) as { id: number } | undefined;
  if (!row) return null;
  return getRefreshRunStatus(row.id);
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

/** A run that's been "running" longer than this is considered stuck
 *  (process crash, killed worker) — the next refresh attempt marks it
 *  as error and starts fresh instead of waiting forever. Generous
 *  enough that a real slow refresh on a big org has plenty of room. */
const STALE_RUN_MS = 5 * 60 * 1000;

/** Mark any "running" row for this org as error if it's been silent
 *  longer than STALE_RUN_MS. Run before starting a new refresh so a
 *  previous crash doesn't leave the UI thinking something's still in
 *  flight forever. */
function reapStaleRuns(orgId: number): void {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  getDb()
    .prepare(
      `UPDATE dashboard_refresh_runs
          SET status = 'error',
              error = 'Marked stale — no progress for >5 min (process crashed?)',
              finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE org_id = ? AND status = 'running' AND started_at < ?`,
    )
    .run(orgId, cutoff);
}

/** Returns the run id of any in-flight refresh for this org, or NULL.
 *  Used to dedupe rapid clicks of the refresh button so a user can't
 *  trigger five overlapping rebuilds at once. */
function findInFlightRun(orgId: number): number | null {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const row = getDb()
    .prepare(
      `SELECT id FROM dashboard_refresh_runs
        WHERE org_id = ? AND status = 'running' AND started_at >= ?
        ORDER BY started_at DESC LIMIT 1`,
    )
    .get(orgId, cutoff) as { id: number } | undefined;
  return row ? row.id : null;
}

/** Fire-and-forget a refresh, return the run id immediately. The
 *  client polls status via getRefreshRunStatus. Critical detail: we
 *  defer the actual work via setImmediate AND use the async refresh
 *  variant — without both, the synchronous better-sqlite3 work would
 *  block the same Node worker that handles the caller's response,
 *  and the action would only return AFTER the rebuild finished
 *  (defeating the whole "background" idea + the progress bar).
 *
 *  Reuses an in-flight run id if one exists for the org so the UI
 *  doesn't end up polling a different runId than the work it
 *  actually triggered. */
export function startRefreshInBackground(orgId: number): number {
  reapStaleRuns(orgId);
  const existing = findInFlightRun(orgId);
  if (existing != null) return existing;

  const runId = createRefreshRun(orgId);
  const promise = new Promise<void>((resolve) => {
    setImmediate(async () => {
      try {
        await refreshDashboardSnapshotsAsync(
          orgId,
          (step, _total, label) => {
            updateRefreshProgress(runId, step, label);
          },
        );
        finishRefreshRun(runId, "ok", null);
      } catch (e) {
        finishRefreshRun(
          runId,
          "error",
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        resolve();
      }
    });
  });
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

/** Async variant of rebuildPersonActivity that yields the Node event
 *  loop after every individual statement, so this rebuild — which
 *  used to take long enough to wedge the entire server — interleaves
 *  with normal page-render requests. The actual SQL is the same as
 *  the sync version below; only the choreography differs. */
async function rebuildPersonActivityAsync(
  orgId: number,
  cutoffActivity: string,
): Promise<void> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const drop = () =>
    db.exec(`
      DROP TABLE IF EXISTS _pa_max_att;
      DROP TABLE IF EXISTS _pa_max_serve;
      DROP TABLE IF EXISTS _pa_grp_count;
      DROP TABLE IF EXISTS _pa_team_count;
      DROP TABLE IF EXISTS _pa_first_comm;
      DROP TABLE IF EXISTS _pa_first_serv;
      DROP TABLE IF EXISTS _pa_wors_grp;
      DROP TABLE IF EXISTS _pa_wors_plan;
      DROP TABLE IF EXISTS _pa_new;
    `);
  drop();
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _pa_max_att AS
       SELECT person_id, MAX(event_starts_at) AS last_at
         FROM pco_event_attendances
        WHERE org_id = ? AND attended = 1
          AND event_starts_at IS NOT NULL AND event_starts_at <= ?
        GROUP BY person_id`,
  ).run(orgId, nowIso);
  db.exec(`CREATE INDEX _pa_max_att_pid ON _pa_max_att(person_id);`);
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _pa_max_serve AS
       SELECT pp.person_id, MAX(pl.sort_date) AS last_at
         FROM pco_plan_people pp
         JOIN pco_plans pl
           ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND pl.sort_date IS NOT NULL AND pl.sort_date <= ?
          AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
        GROUP BY pp.person_id`,
  ).run(orgId, nowIso);
  db.exec(`CREATE INDEX _pa_max_serve_pid ON _pa_max_serve(person_id);`);
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _pa_grp_count AS
       SELECT person_id, COUNT(*) AS n
         FROM pco_group_memberships
        WHERE org_id = ? AND archived_at IS NULL
        GROUP BY person_id`,
  ).run(orgId);
  db.exec(`CREATE INDEX _pa_grp_count_pid ON _pa_grp_count(person_id);`);
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _pa_team_count AS
       SELECT person_id, COUNT(*) AS n
         FROM pco_team_memberships
        WHERE org_id = ? AND archived_at IS NULL AND person_id != ''
        GROUP BY person_id`,
  ).run(orgId);
  db.exec(`CREATE INDEX _pa_team_count_pid ON _pa_team_count(person_id);`);
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _pa_first_comm AS
       SELECT person_id, MIN(joined_at) AS at
         FROM pco_group_memberships
        WHERE org_id = ? AND joined_at IS NOT NULL AND joined_at <= ?
        GROUP BY person_id`,
  ).run(orgId, nowIso);
  db.exec(`CREATE INDEX _pa_first_comm_pid ON _pa_first_comm(person_id);`);
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _pa_first_serv AS
       SELECT person_id, MIN(pco_created_at) AS at
         FROM pco_team_memberships
        WHERE org_id = ?
          AND person_id != ''
          AND pco_created_at IS NOT NULL AND pco_created_at <= ?
        GROUP BY person_id`,
  ).run(orgId, nowIso);
  db.exec(`CREATE INDEX _pa_first_serv_pid ON _pa_first_serv(person_id);`);
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _pa_wors_grp AS
       SELECT DISTINCT person_id FROM pco_event_attendances
        WHERE org_id = ? AND attended = 1 AND event_starts_at >= ?`,
  ).run(orgId, cutoffActivity);
  db.exec(`CREATE UNIQUE INDEX _pa_wors_grp_pid ON _pa_wors_grp(person_id);`);
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _pa_wors_plan AS
       SELECT DISTINCT pp.person_id FROM pco_plan_people pp
         JOIN pco_plans pl
           ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND pl.sort_date >= ?
          AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')`,
  ).run(orgId, cutoffActivity);
  db.exec(`CREATE UNIQUE INDEX _pa_wors_plan_pid ON _pa_wors_plan(person_id);`);
  await yieldTick();

  // Build the whole rebuilt snapshot into a TEMP staging table first
  // — readers querying person_activity see the OLD state the whole
  // time, until the fast DELETE+INSERT swap at the very end.
  db.prepare(
    `CREATE TEMP TABLE _pa_new AS
     SELECT
       p.org_id,
       p.pco_id AS person_id,
       p.last_form_submission_at AS last_form_at,
       p.last_check_in_at,
       ma.last_at AS last_attended_at,
       ms.last_at AS last_served_at,
       p.pco_updated_at AS last_pco_updated_at,
       NULLIF(MAX(
         coalesce(CASE WHEN p.last_form_submission_at <= ?
                       THEN p.last_form_submission_at END, ''),
         coalesce(CASE WHEN p.last_check_in_at <= ?
                       THEN p.last_check_in_at END, ''),
         coalesce(CASE WHEN p.pco_updated_at <= ?
                       THEN p.pco_updated_at END, ''),
         coalesce(ma.last_at, ''),
         coalesce(ms.last_at, '')
       ), '') AS last_activity_at,
       coalesce(gc.n, 0) AS active_group_count,
       coalesce(tc.n, 0) AS active_team_count,
       CASE WHEN wg.person_id IS NOT NULL OR wp.person_id IS NOT NULL
            THEN 1 ELSE 0 END AS in_lane_wors,
       CASE WHEN coalesce(gc.n, 0) > 0 THEN 1 ELSE 0 END AS in_lane_comm,
       CASE WHEN coalesce(tc.n, 0) > 0 THEN 1 ELSE 0 END AS in_lane_serv,
       fc.at AS first_comm_at,
       fs.at AS first_serv_at
     FROM pco_people p
     LEFT JOIN _pa_max_att     ma ON ma.person_id = p.pco_id
     LEFT JOIN _pa_max_serve   ms ON ms.person_id = p.pco_id
     LEFT JOIN _pa_grp_count   gc ON gc.person_id = p.pco_id
     LEFT JOIN _pa_team_count  tc ON tc.person_id = p.pco_id
     LEFT JOIN _pa_first_comm  fc ON fc.person_id = p.pco_id
     LEFT JOIN _pa_first_serv  fs ON fs.person_id = p.pco_id
     LEFT JOIN _pa_wors_grp    wg ON wg.person_id = p.pco_id
     LEFT JOIN _pa_wors_plan   wp ON wp.person_id = p.pco_id
     WHERE p.org_id = ?`,
  ).run(nowIso, nowIso, nowIso, orgId);
  await yieldTick();

  // Atomic swap: tiny transaction, just data movement from the temp
  // staging table into the canonical one. Other readers either see
  // the fully-old or fully-new state — never a half-rebuilt one.
  db.transaction(() => {
    db.prepare(`DELETE FROM person_activity WHERE org_id = ?`).run(orgId);
    db.prepare(
      `INSERT INTO person_activity
         (org_id, person_id,
          last_form_at, last_check_in_at, last_attended_at, last_served_at,
          last_pco_updated_at, last_activity_at,
          active_group_count, active_team_count,
          in_lane_wors, in_lane_comm, in_lane_serv,
          first_comm_at, first_serv_at, classification)
       SELECT org_id, person_id,
              last_form_at, last_check_in_at, last_attended_at, last_served_at,
              last_pco_updated_at, last_activity_at,
              active_group_count, active_team_count,
              in_lane_wors, in_lane_comm, in_lane_serv,
              first_comm_at, first_serv_at, NULL
         FROM _pa_new`,
    ).run();
  })();

  drop();
}

/** Group-summary rebuild with a similar staging-table pattern + yield
 *  between the build and the swap. Smaller and faster than person_-
 *  activity but still worth keeping off the main thread for as long
 *  as possible. */
async function rebuildGroupSummaryAsync(
  orgId: number,
  activityMonths: number,
  cutoff30: string,
): Promise<void> {
  const db = getDb();
  const trackingCutoff = new Date(
    Date.now() - activityMonths * MS_PER_MONTH,
  ).toISOString();
  db.exec(`DROP TABLE IF EXISTS _gs_new;`);
  await yieldTick();

  db.prepare(
    `CREATE TEMP TABLE _gs_new AS
     SELECT
       g.org_id,
       g.pco_id AS group_id,
       coalesce(mpg.members, 0) AS members,
       coalesce(mpg.leaders, 0) AS leaders,
       coalesce(mpg.joined_30d, 0) AS joined_30d,
       coalesce(mpg.left_30d, 0) AS left_30d,
       coalesce(apg.attended_distinct_window, 0) AS attended_distinct_window,
       coalesce(epg.events_window, 0) AS events_window,
       CASE
         WHEN coalesce(mpg.members, 0) = 0
           OR coalesce(apg.attended_distinct_window, 0) = 0
              THEN NULL
         ELSE MIN(100, (apg.attended_distinct_window * 100.0) / mpg.members)
       END AS attendance_pct,
       CASE
         WHEN g.archived_at IS NOT NULL                          THEN 'paused'
         WHEN coalesce(epg.events_window, 0) = 0
          AND coalesce(mpg.members, 0) > 0                       THEN 'paused'
         WHEN coalesce(mpg.joined_30d, 0)
            - coalesce(mpg.left_30d, 0) >= 2                     THEN 'growing'
         WHEN coalesce(mpg.joined_30d, 0)
            - coalesce(mpg.left_30d, 0) <= -2                    THEN 'shrinking'
         ELSE 'steady'
       END AS state
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
       SELECT group_id, COUNT(*) AS events_window
         FROM pco_group_events
        WHERE org_id = ? AND starts_at IS NOT NULL AND starts_at >= ?
        GROUP BY group_id
     ) epg ON epg.group_id = g.pco_id
     WHERE g.org_id = ?`,
  ).run(
    cutoff30, cutoff30, orgId,
    orgId, trackingCutoff,
    orgId, trackingCutoff,
    orgId,
  );
  await yieldTick();

  db.transaction(() => {
    db.prepare(`DELETE FROM group_summary WHERE org_id = ?`).run(orgId);
    db.prepare(
      `INSERT INTO group_summary
         (org_id, group_id, members, leaders, joined_30d, left_30d,
          attended_distinct_window, events_window, attendance_pct, state)
       SELECT org_id, group_id, members, leaders, joined_30d, left_30d,
              attended_distinct_window, events_window, attendance_pct, state
         FROM _gs_new`,
    ).run();
  })();
  db.exec(`DROP TABLE IF EXISTS _gs_new;`);
}

function rebuildPersonActivity(
  orgId: number,
  cutoffActivity: string,
): void {
  const db = getDb();
  const nowIso = new Date().toISOString();

  // Previous version did ~10 correlated subqueries PER person row in
  // a single INSERT-SELECT — O(people × subqueries) which on real
  // data was tens of seconds and felt like a hang. The rewrite below
  // builds eight connection-local TEMP tables in one indexed scan
  // each, then JOINs them into the INSERT — one indexed lookup per
  // JOIN per row instead of a fresh subquery execution per row.

  db.exec(`
    DROP TABLE IF EXISTS _pa_max_att;
    DROP TABLE IF EXISTS _pa_max_serve;
    DROP TABLE IF EXISTS _pa_grp_count;
    DROP TABLE IF EXISTS _pa_team_count;
    DROP TABLE IF EXISTS _pa_first_comm;
    DROP TABLE IF EXISTS _pa_first_serv;
    DROP TABLE IF EXISTS _pa_wors_grp;
    DROP TABLE IF EXISTS _pa_wors_plan;
  `);
  db.prepare(
    `CREATE TEMP TABLE _pa_max_att AS
       SELECT person_id, MAX(event_starts_at) AS last_at
         FROM pco_event_attendances
        WHERE org_id = ? AND attended = 1
          AND event_starts_at IS NOT NULL AND event_starts_at <= ?
        GROUP BY person_id`,
  ).run(orgId, nowIso);
  db.exec(`CREATE INDEX _pa_max_att_pid ON _pa_max_att(person_id);`);
  db.prepare(
    `CREATE TEMP TABLE _pa_max_serve AS
       SELECT pp.person_id, MAX(pl.sort_date) AS last_at
         FROM pco_plan_people pp
         JOIN pco_plans pl
           ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND pl.sort_date IS NOT NULL AND pl.sort_date <= ?
          AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
        GROUP BY pp.person_id`,
  ).run(orgId, nowIso);
  db.exec(`CREATE INDEX _pa_max_serve_pid ON _pa_max_serve(person_id);`);
  db.prepare(
    `CREATE TEMP TABLE _pa_grp_count AS
       SELECT person_id, COUNT(*) AS n
         FROM pco_group_memberships
        WHERE org_id = ? AND archived_at IS NULL
        GROUP BY person_id`,
  ).run(orgId);
  db.exec(`CREATE INDEX _pa_grp_count_pid ON _pa_grp_count(person_id);`);
  db.prepare(
    `CREATE TEMP TABLE _pa_team_count AS
       SELECT person_id, COUNT(*) AS n
         FROM pco_team_memberships
        WHERE org_id = ? AND archived_at IS NULL AND person_id != ''
        GROUP BY person_id`,
  ).run(orgId);
  db.exec(`CREATE INDEX _pa_team_count_pid ON _pa_team_count(person_id);`);
  db.prepare(
    `CREATE TEMP TABLE _pa_first_comm AS
       SELECT person_id, MIN(joined_at) AS at
         FROM pco_group_memberships
        WHERE org_id = ? AND joined_at IS NOT NULL AND joined_at <= ?
        GROUP BY person_id`,
  ).run(orgId, nowIso);
  db.exec(`CREATE INDEX _pa_first_comm_pid ON _pa_first_comm(person_id);`);
  db.prepare(
    `CREATE TEMP TABLE _pa_first_serv AS
       SELECT person_id, MIN(pco_created_at) AS at
         FROM pco_team_memberships
        WHERE org_id = ?
          AND person_id != ''
          AND pco_created_at IS NOT NULL AND pco_created_at <= ?
        GROUP BY person_id`,
  ).run(orgId, nowIso);
  db.exec(`CREATE INDEX _pa_first_serv_pid ON _pa_first_serv(person_id);`);
  // For in_lane_wors we need "any group event attendance in window"
  // OR "any non-declined plan serve in window" — two single-pass
  // sets that the INSERT probes via O(1) indexed lookups per row.
  db.prepare(
    `CREATE TEMP TABLE _pa_wors_grp AS
       SELECT DISTINCT person_id FROM pco_event_attendances
        WHERE org_id = ? AND attended = 1 AND event_starts_at >= ?`,
  ).run(orgId, cutoffActivity);
  db.exec(`CREATE UNIQUE INDEX _pa_wors_grp_pid ON _pa_wors_grp(person_id);`);
  db.prepare(
    `CREATE TEMP TABLE _pa_wors_plan AS
       SELECT DISTINCT pp.person_id FROM pco_plan_people pp
         JOIN pco_plans pl
           ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
        WHERE pp.org_id = ?
          AND pp.person_id != ''
          AND pl.sort_date >= ?
          AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')`,
  ).run(orgId, cutoffActivity);
  db.exec(`CREATE UNIQUE INDEX _pa_wors_plan_pid ON _pa_wors_plan(person_id);`);

  // Single INSERT — every per-person value comes from a LEFT JOIN
  // against one of the temp tables above. last_activity_at is the
  // MAX of five scalar columns (coalesce empty string for NULLs so
  // MAX still picks the largest real timestamp), normalized back to
  // NULL afterward.
  db.prepare(`DELETE FROM person_activity WHERE org_id = ?`).run(orgId);
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
       p.org_id,
       p.pco_id,
       p.last_form_submission_at,
       p.last_check_in_at,
       ma.last_at,
       ms.last_at,
       p.pco_updated_at,
       MAX(
         coalesce(CASE WHEN p.last_form_submission_at <= ?
                       THEN p.last_form_submission_at END, ''),
         coalesce(CASE WHEN p.last_check_in_at <= ?
                       THEN p.last_check_in_at END, ''),
         coalesce(CASE WHEN p.pco_updated_at <= ?
                       THEN p.pco_updated_at END, ''),
         coalesce(ma.last_at, ''),
         coalesce(ms.last_at, '')
       ),
       coalesce(gc.n, 0),
       coalesce(tc.n, 0),
       CASE WHEN wg.person_id IS NOT NULL OR wp.person_id IS NOT NULL
            THEN 1 ELSE 0 END,
       CASE WHEN coalesce(gc.n, 0) > 0 THEN 1 ELSE 0 END,
       CASE WHEN coalesce(tc.n, 0) > 0 THEN 1 ELSE 0 END,
       fc.at,
       fs.at,
       NULL
     FROM pco_people p
     LEFT JOIN _pa_max_att     ma ON ma.person_id = p.pco_id
     LEFT JOIN _pa_max_serve   ms ON ms.person_id = p.pco_id
     LEFT JOIN _pa_grp_count   gc ON gc.person_id = p.pco_id
     LEFT JOIN _pa_team_count  tc ON tc.person_id = p.pco_id
     LEFT JOIN _pa_first_comm  fc ON fc.person_id = p.pco_id
     LEFT JOIN _pa_first_serv  fs ON fs.person_id = p.pco_id
     LEFT JOIN _pa_wors_grp    wg ON wg.person_id = p.pco_id
     LEFT JOIN _pa_wors_plan   wp ON wp.person_id = p.pco_id
     WHERE p.org_id = ?`,
  ).run(nowIso, nowIso, nowIso, orgId);

  // Normalize the empty-string sentinel back to NULL for people who
  // had no signals at all — the read paths sort NULLS FIRST.
  db.prepare(
    `UPDATE person_activity
        SET last_activity_at = NULL
      WHERE org_id = ? AND last_activity_at = ''`,
  ).run(orgId);

  // Free the temp tables — connection-local, would otherwise stay
  // around until the connection closes (memory cost on a hot worker).
  db.exec(`
    DROP TABLE IF EXISTS _pa_max_att;
    DROP TABLE IF EXISTS _pa_max_serve;
    DROP TABLE IF EXISTS _pa_grp_count;
    DROP TABLE IF EXISTS _pa_team_count;
    DROP TABLE IF EXISTS _pa_first_comm;
    DROP TABLE IF EXISTS _pa_first_serv;
    DROP TABLE IF EXISTS _pa_wors_grp;
    DROP TABLE IF EXISTS _pa_wors_plan;
  `);
}

/** Second pass on person_activity that fills in the classification
 *  using the same priority rule as people-read.ts (shepherded >
 *  active > present > inactive). Kept separate from the insert so
 *  the refresh progress bar can report it as its own step. */
function classifyPersonActivity(orgId: number, cutoffActivity: string): void {
  const db = getDb();
  // Build the canonical shepherded set — the SAME definition /people
  // (live path) and /care-map use: it honors excluded group/team
  // types + positions AND the dependent-check-in shepherding path.
  // The old shortcut here ("active_group_count>0 OR active_team_count
  // >0") ignored both, so the snapshot's active/shepherded split
  // diverged from the live computation — care showed 1,452 active
  // adults while /people (snapshot) showed 1,466. Using shep_set keeps
  // them identical.
  populateShepherdedTempTable(orgId);
  db.prepare(
    `UPDATE person_activity
        SET classification = CASE
              WHEN person_id IN (SELECT person_id FROM temp.shep_set)
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
  // Excluded membership types are dropped from the headline counts so
  // org_snapshot matches the LIVE getClassificationCounts (which also
  // excludes them) AND the care map. Without this, the snapshot
  // counted excluded-membership people as active/present while the
  // live paths didn't — another source of the /people-vs-care gap.
  const excludedMem = getExcludedMembershipTypes(orgId);
  const memSql =
    excludedMem.length === 0
      ? ""
      : ` AND (p.membership_type IS NULL OR p.membership_type NOT IN (${excludedMem
          .map(() => "?")
          .join(",")}))`;
  // Totals roll up from person_activity JOIN pco_people for is_minor.
  // Kid sub-counts get stored on the snapshot so the read path doesn't
  // have to re-run this join on every page render.
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN pa.classification = 'shepherded' THEN 1 ELSE 0 END) AS shepherded,
         SUM(CASE WHEN pa.classification = 'active'     THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN pa.classification = 'present'    THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN pa.classification = 'inactive'   THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN pa.classification = 'shepherded'
                   AND p.is_minor = 1 THEN 1 ELSE 0 END) AS shepherdedKids,
         SUM(CASE WHEN pa.classification = 'active'
                   AND p.is_minor = 1 THEN 1 ELSE 0 END) AS activeKids,
         SUM(CASE WHEN pa.classification = 'present'
                   AND p.is_minor = 1 THEN 1 ELSE 0 END) AS presentKids,
         SUM(CASE WHEN pa.classification = 'inactive'
                   AND p.is_minor = 1 THEN 1 ELSE 0 END) AS inactiveKids,
         SUM(CASE WHEN pa.active_group_count = 0
                   AND pa.active_team_count = 0
                  THEN 1 ELSE 0 END) AS unshepherded,
         SUM(pa.in_lane_wors) AS lane_wors,
         SUM(pa.in_lane_comm) AS lane_comm,
         SUM(pa.in_lane_serv) AS lane_serv,
         SUM(CASE WHEN pa.in_lane_wors = 0 AND pa.in_lane_comm = 0
                   AND pa.in_lane_serv = 0
                  THEN 1 ELSE 0 END) AS lane_none
       FROM person_activity pa
       JOIN pco_people p
         ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
       WHERE pa.org_id = ?${memSql}`,
    )
    .get(orgId, ...excludedMem) as {
    total: number;
    shepherded: number;
    active: number;
    present: number;
    inactive: number;
    shepherdedKids: number;
    activeKids: number;
    presentKids: number;
    inactiveKids: number;
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
        shepherded_kids, active_kids, present_kids, inactive_kids,
        refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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
       shepherded_kids = excluded.shepherded_kids,
       active_kids = excluded.active_kids,
       present_kids = excluded.present_kids,
       inactive_kids = excluded.inactive_kids,
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
    counts.shepherdedKids,
    counts.activeKids,
    counts.presentKids,
    counts.inactiveKids,
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
  shepherdedKids: number;
  activeKids: number;
  presentKids: number;
  inactiveKids: number;
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

// ─── Lane transitions (aggregated chronology) ────────────────────

type LaneState = "none" | "comm" | "serv" | "both";

function laneStateFor(commCount: number, servCount: number): LaneState {
  if (commCount > 0 && servCount > 0) return "both";
  if (commCount > 0) return "comm";
  if (servCount > 0) return "serv";
  return "none";
}

/** For each person, build their full chronology of lane-state
 *  transitions from their group + team membership history. Aggregate
 *  the (prev_state, next_state) counts across the org, then write
 *  into lane_transitions for fast reads.
 *
 *  Why per-person chronologies rather than just first→current:
 *  someone who went none → comm → both → serv → none generates FOUR
 *  transition records (one per arrow), and aggregating across the
 *  org reveals the actual on-ramps and drop-off points — not just
 *  net "where they ended up". */
function rebuildLaneTransitions(orgId: number): void {
  const db = getDb();
  // Pull every group + team membership row with the dates that
  // change lane state — joined_at / archived_at for groups,
  // pco_created_at / archived_at for teams.
  const groupRows = db
    .prepare(
      `SELECT person_id, joined_at, archived_at
         FROM pco_group_memberships
        WHERE org_id = ?
          AND person_id != ''`,
    )
    .all(orgId) as Array<{
    person_id: string;
    joined_at: string | null;
    archived_at: string | null;
  }>;
  const teamRows = db
    .prepare(
      `SELECT person_id, pco_created_at, archived_at
         FROM pco_team_memberships
        WHERE org_id = ?
          AND person_id != ''`,
    )
    .all(orgId) as Array<{
    person_id: string;
    pco_created_at: string | null;
    archived_at: string | null;
  }>;

  // (person_id) → list of events (at + delta to comm or serv counter).
  type Event = {
    at: string;
    deltaComm: number;
    deltaServ: number;
  };
  const byPerson = new Map<string, Event[]>();
  function push(personId: string, ev: Event) {
    const arr = byPerson.get(personId);
    if (arr) arr.push(ev);
    else byPerson.set(personId, [ev]);
  }
  for (const r of groupRows) {
    if (r.joined_at) {
      push(r.person_id, {
        at: r.joined_at,
        deltaComm: 1,
        deltaServ: 0,
      });
    }
    if (r.archived_at) {
      push(r.person_id, {
        at: r.archived_at,
        deltaComm: -1,
        deltaServ: 0,
      });
    }
  }
  for (const r of teamRows) {
    if (r.pco_created_at) {
      push(r.person_id, {
        at: r.pco_created_at,
        deltaComm: 0,
        deltaServ: 1,
      });
    }
    if (r.archived_at) {
      push(r.person_id, {
        at: r.archived_at,
        deltaComm: 0,
        deltaServ: -1,
      });
    }
  }

  // Aggregate transitions across the whole org.
  const counts = new Map<string, number>();
  for (const events of byPerson.values()) {
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    let comm = 0;
    let serv = 0;
    let prev: LaneState = "none";
    for (const e of events) {
      comm = Math.max(0, comm + e.deltaComm);
      serv = Math.max(0, serv + e.deltaServ);
      const next = laneStateFor(comm, serv);
      if (next !== prev) {
        const k = `${prev}>${next}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
        prev = next;
      }
    }
  }

  // Wipe + repopulate. Tiny table, fast.
  db.transaction(() => {
    db.prepare(`DELETE FROM lane_transitions WHERE org_id = ?`).run(orgId);
    const stmt = db.prepare(
      `INSERT INTO lane_transitions (org_id, from_state, to_state, count)
       VALUES (?, ?, ?, ?)`,
    );
    for (const [k, n] of counts.entries()) {
      const [from, to] = k.split(">") as [LaneState, LaneState];
      stmt.run(orgId, from, to, n);
    }
  })();
}

export interface LaneTransition {
  from: LaneCategory;
  to: LaneCategory;
  count: number;
}

export interface LaneTransitionSummary {
  /** All non-zero transitions, sorted by count desc. */
  transitions: LaneTransition[];
  /** Per-source totals (sum of outflows per state). */
  fromTotals: Record<LaneCategory, number>;
  /** Per-destination totals (sum of inflows per state). */
  toTotals: Record<LaneCategory, number>;
  /** Sum across all transitions — equals fromTotals total and
   *  toTotals total by construction. */
  total: number;
}

export function getLaneTransitions(orgId: number): LaneTransitionSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT from_state AS fromState, to_state AS toState, count
         FROM lane_transitions WHERE org_id = ? AND count > 0
         ORDER BY count DESC`,
    )
    .all(orgId) as Array<{
    fromState: LaneCategory;
    toState: LaneCategory;
    count: number;
  }>;
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
  let total = 0;
  for (const r of rows) {
    fromTotals[r.fromState] += r.count;
    toTotals[r.toState] += r.count;
    total += r.count;
  }
  return {
    transitions: rows.map((r) => ({
      from: r.fromState,
      to: r.toState,
      count: r.count,
    })),
    fromTotals,
    toTotals,
    total,
  };
}

// ─── Lane sequences (ordered journey patterns) ───────────────────

export interface LaneSequence {
  /** Ordered list of category keys, e.g. ["serv", "comm"]. */
  seq: LaneCategory[];
  /** Number of people who match this exact entry pattern. */
  count: number;
  /** Human-readable headline ("Entered serving, then community"). */
  label: string;
  /** Short note — "healthy onramp", "stuck after entry", etc. */
  note: string;
  /** Tone hint for the count chip. */
  tone: "good" | "warn" | "muted" | "accent";
}

/** Rolls up the same person_activity buckets that drive the sankey
 *  into ordered "journey" sequences. Each sequence is the chronology
 *  of lane entries (community / serving) the person went through —
 *  read from first_comm_at + first_serv_at — followed by the current
 *  retention state.
 *
 *  Only Community + Serving are modeled (Worship needs check-in,
 *  Giving needs PCO Giving sync). Sequences with 0 matches are
 *  filtered out so the list shows only patterns the org actually
 *  has people in. Sorted by count desc — heaviest first. */
export function getLaneSequences(orgId: number): LaneSequence[] {
  const db = getDb();
  const SAME_TIME_MS = 30 * 86_400_000;
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

  // Bucket keys we'll roll up into.
  type Key =
    | "serv_then_comm_stayed"
    | "serv_then_comm_lost"
    | "comm_then_serv_stayed"
    | "comm_then_serv_lost"
    | "both_at_once_stayed"
    | "both_at_once_lost"
    | "comm_only_stayed"
    | "comm_only_dropped"
    | "serv_only_stayed"
    | "serv_only_dropped"
    | "never";
  const counts: Record<Key, number> = {
    serv_then_comm_stayed: 0,
    serv_then_comm_lost: 0,
    comm_then_serv_stayed: 0,
    comm_then_serv_lost: 0,
    both_at_once_stayed: 0,
    both_at_once_lost: 0,
    comm_only_stayed: 0,
    comm_only_dropped: 0,
    serv_only_stayed: 0,
    serv_only_dropped: 0,
    never: 0,
  };

  for (const r of rows) {
    const haveComm = !!r.first_comm_at;
    const haveServ = !!r.first_serv_at;
    const stillComm = r.active_group_count > 0;
    const stillServ = r.active_team_count > 0;
    if (!haveComm && !haveServ) {
      counts.never++;
      continue;
    }
    if (haveComm && haveServ) {
      const dComm = new Date(r.first_comm_at!).getTime();
      const dServ = new Date(r.first_serv_at!).getTime();
      if (Math.abs(dComm - dServ) <= SAME_TIME_MS) {
        if (stillComm && stillServ) counts.both_at_once_stayed++;
        else counts.both_at_once_lost++;
      } else if (dComm < dServ) {
        if (stillComm && stillServ) counts.comm_then_serv_stayed++;
        else counts.comm_then_serv_lost++;
      } else {
        if (stillComm && stillServ) counts.serv_then_comm_stayed++;
        else counts.serv_then_comm_lost++;
      }
      continue;
    }
    if (haveComm && !haveServ) {
      if (stillComm) counts.comm_only_stayed++;
      else counts.comm_only_dropped++;
    } else {
      if (stillServ) counts.serv_only_stayed++;
      else counts.serv_only_dropped++;
    }
  }

  const seqs: LaneSequence[] = [
    {
      seq: ["comm", "serv"],
      count: counts.comm_then_serv_stayed,
      label: "Community first, then added serving",
      note: "Healthy onramp — group brought them into a team. Still in both.",
      tone: "good",
    },
    {
      seq: ["serv", "comm"],
      count: counts.serv_then_comm_stayed,
      label: "Serving first, then added community",
      note: "Team brought them into a group. Still in both.",
      tone: "good",
    },
    {
      seq: ["both"],
      count: counts.both_at_once_stayed,
      label: "Entered both lanes together",
      note: "Joined community + serving within 30 days. Still in both.",
      tone: "accent",
    },
    {
      seq: ["comm"],
      count: counts.comm_only_stayed,
      label: "Community only",
      note: "Never moved into serving — invite candidates.",
      tone: "muted",
    },
    {
      seq: ["serv"],
      count: counts.serv_only_stayed,
      label: "Serving only",
      note: "Never joined a group — connect to community.",
      tone: "muted",
    },
    {
      seq: ["comm", "none"],
      count: counts.comm_only_dropped + counts.comm_then_serv_lost,
      label: "Community first, then dropped off",
      note: "Was in a group, now in nothing — care follow-up.",
      tone: "warn",
    },
    {
      seq: ["serv", "none"],
      count: counts.serv_only_dropped + counts.serv_then_comm_lost,
      label: "Serving first, then dropped off",
      note: "Was on a team, now in nothing — re-engage.",
      tone: "warn",
    },
    {
      seq: ["both", "none"],
      count: counts.both_at_once_lost,
      label: "Entered both, then dropped off",
      note: "Was in both lanes — surprising attrition.",
      tone: "warn",
    },
    {
      seq: ["none"],
      count: counts.never,
      label: "Never entered either lane",
      note: "On the books but no group/team history.",
      tone: "muted",
    },
  ];

  return seqs.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
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
              shepherded_kids AS shepherdedKids,
              active_kids AS activeKids,
              present_kids AS presentKids,
              inactive_kids AS inactiveKids,
              refreshed_at AS refreshedAt
         FROM org_snapshot WHERE org_id = ?`,
    )
    .get(orgId) as OrgSnapshot | undefined;
  return row ?? null;
}
