import "server-only";
import { getDb } from "./db";
import { getExcludedTeamTypes } from "./pco";

export interface SyncedTeamRow {
  pcoId: string;
  name: string | null;
  serviceTypeName: string | null;
  archivedAt: string | null;
  members: number;
  leaders: number;
  servedRecently: number;
  lapsed: number;
  state: "growing" | "steady" | "shrinking" | "paused";
}

export interface TeamTotals {
  totalTeams: number;
  activeTeams: number;
  totalMembers: number;
  totalLeaders: number;
  totalLapsed: number;
  servedRecently: number;
  growing: number;
  steady: number;
  shrinking: number;
  paused: number;
}

/** List teams with member/leader counts + recent serving activity. */
export function listTeams(
  orgId: number,
  activityMonths: number,
  lapsedWeeks: number,
): SyncedTeamRow[] {
  const db = getDb();
  const excludedTypes = getExcludedTeamTypes(orgId);
  const exclusionPlaceholders = excludedTypes.length
    ? `AND coalesce(t.service_type_id, '') NOT IN (${excludedTypes.map(() => "?").join(",")})`
    : "";

  const activityCutoff = new Date(
    Date.now() - activityMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const lapsedCutoff = new Date(
    Date.now() - lapsedWeeks * 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = db
    .prepare(
      `SELECT
         t.pco_id          AS pcoId,
         t.name            AS name,
         st.name           AS serviceTypeName,
         t.archived_at     AS archivedAt,
         (SELECT COUNT(*)
            FROM pco_team_memberships m
            WHERE m.org_id = t.org_id
              AND m.team_id = t.pco_id
              AND m.archived_at IS NULL
              AND m.person_id != '') AS members,
         (SELECT COUNT(*)
            FROM pco_team_memberships m
            WHERE m.org_id = t.org_id
              AND m.team_id = t.pco_id
              AND m.archived_at IS NULL
              AND m.is_team_leader = 1
              AND m.person_id != '') AS leaders,
         (SELECT COUNT(DISTINCT pp.person_id)
            FROM pco_plan_people pp
            JOIN pco_plans p
              ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
            WHERE pp.org_id = t.org_id
              AND pp.team_id = t.pco_id
              AND pp.person_id != ''
              AND p.sort_date >= ?
              AND lower(coalesce(pp.status, 'c')) IN ('c','confirmed','u','unconfirmed')) AS servedRecently,
         (SELECT COUNT(*)
            FROM pco_team_memberships m
            WHERE m.org_id = t.org_id
              AND m.team_id = t.pco_id
              AND m.archived_at IS NULL
              AND m.person_id != ''
              AND (m.last_served_at IS NULL OR m.last_served_at < ?)) AS lapsed
       FROM pco_teams t
       LEFT JOIN pco_service_types st
         ON st.org_id = t.org_id AND st.pco_id = t.service_type_id
       WHERE t.org_id = ?
         AND t.deleted_at IS NULL
         ${exclusionPlaceholders}
       ORDER BY
         CASE WHEN t.archived_at IS NULL THEN 0 ELSE 1 END,
         members DESC,
         t.name ASC`,
    )
    .all(activityCutoff, lapsedCutoff, orgId, ...excludedTypes) as Array<{
    pcoId: string;
    name: string | null;
    serviceTypeName: string | null;
    archivedAt: string | null;
    members: number;
    leaders: number;
    servedRecently: number;
    lapsed: number;
  }>;

  return rows.map((r) => ({
    ...r,
    state: classifyState(r.members, r.servedRecently, r.lapsed, r.archivedAt),
  }));
}

function classifyState(
  members: number,
  servedRecently: number,
  lapsed: number,
  archivedAt: string | null,
): "growing" | "steady" | "shrinking" | "paused" {
  if (archivedAt) return "paused";
  if (members === 0) return "paused";
  if (servedRecently === 0) return "paused";
  const lapsedRatio = lapsed / members;
  if (lapsedRatio >= 0.5) return "shrinking";
  if (servedRecently >= members * 0.6) return "growing";
  return "steady";
}

export function getTeamTotals(
  orgId: number,
  activityMonths: number,
  lapsedWeeks: number,
): TeamTotals {
  const rows = listTeams(orgId, activityMonths, lapsedWeeks);
  const t: TeamTotals = {
    totalTeams: rows.length,
    activeTeams: 0,
    totalMembers: 0,
    totalLeaders: 0,
    totalLapsed: 0,
    servedRecently: 0,
    growing: 0,
    steady: 0,
    shrinking: 0,
    paused: 0,
  };
  for (const r of rows) {
    if (!r.archivedAt) t.activeTeams++;
    t.totalMembers += r.members;
    t.totalLeaders += r.leaders;
    t.totalLapsed += r.lapsed;
    t.servedRecently += r.servedRecently;
    t[r.state]++;
  }
  return t;
}
