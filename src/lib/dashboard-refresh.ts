import "server-only";
import { getDb } from "./db";
import { getSyncSettings } from "./pco";

const MS_PER_DAY = 86_400_000;
const MS_PER_MONTH = 30 * MS_PER_DAY;

/** Rebuild every dashboard / lanes / home summary table for an org
 *  from scratch. Runs in a single transaction so readers never see a
 *  half-rebuilt set of snapshots. Cheap to call (single-digit seconds
 *  even on multi-thousand-person orgs) — designed to run after every
 *  PCO sync, and on demand from the admin "refresh stats" button.
 *
 *  The whole thing is one transaction because the snapshots are
 *  derived data; if any step fails we'd rather show yesterday's
 *  numbers than a Frankenstein of half-old half-new rows. */
export function refreshDashboardSnapshots(orgId: number): void {
  const db = getDb();
  const settings = getSyncSettings(orgId);
  const activityMonths = settings.activityMonths;
  const cutoffActivity = new Date(
    Date.now() - activityMonths * MS_PER_MONTH,
  ).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();

  db.transaction(() => {
    rebuildPersonActivity(orgId, cutoffActivity, activityMonths);
    rebuildGroupSummary(orgId, activityMonths, cutoff30);
    rebuildOrgSnapshot(orgId, activityMonths);
  })();
}

function rebuildPersonActivity(
  orgId: number,
  cutoffActivity: string,
  activityMonths: number,
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
       NULL  -- classification filled in by a second pass below
     FROM pco_people p
     WHERE p.org_id = ?`,
  ).run(
    orgId,
    nowIso, nowIso, // attended / served upper bounds
    nowIso, nowIso, nowIso, nowIso, nowIso, // last_activity max sub-queries
    cutoffActivity, cutoffActivity, // in_lane_wors cutoffs
    orgId,
  );

  // Second pass: derive classification using the same priority rule
  // as people-read.ts (shepherded > active > present > inactive).
  // "Active" only looks at form submission + check-in, NOT plan-served
  // or group-attendance — kept that way so the headline numbers match
  // the Metrics page exactly. (Attendance / serving still appear in
  // last_activity_at for the "Falling through the cracks" sort.)
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
  ).run(
    cutoffActivity,
    cutoffActivity,
    cutoffActivity,
    orgId,
  );

  void activityMonths;
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
