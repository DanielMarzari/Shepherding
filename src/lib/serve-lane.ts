import "server-only";
import { getDb } from "./db";
import { getExcludedTeamTypes } from "./pco";

export interface SyncedTeamRow {
  pcoId: string;
  name: string | null;
  serviceTypeName: string | null;
  archivedAt: string | null;
  /** Distinct people on the active roster (PersonTeamPositionAssignment can
   *  have one person × many positions; we want the headcount). */
  members: number;
  leaders: number;
  /** Distinct people who served in any plan during the activity window. */
  servedRecently: number;
  /** Roster members whose last_served_at is older than the lapsed-from-team
   *  threshold (or null = never served on a recorded plan). */
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

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

/** List teams with member/leader counts + recent serving activity. */
export function listTeams(
  orgId: number,
  activityMonths: number,
  lapsedMonths: number,
): SyncedTeamRow[] {
  const db = getDb();
  const excludedTypes = getExcludedTeamTypes(orgId);
  const exclusionPlaceholders = excludedTypes.length
    ? `AND coalesce(t.service_type_id, '') NOT IN (${excludedTypes.map(() => "?").join(",")})`
    : "";

  const activityCutoff = new Date(
    Date.now() - activityMonths * MS_PER_MONTH,
  ).toISOString();
  const lapsedCutoff = new Date(
    Date.now() - lapsedMonths * MS_PER_MONTH,
  ).toISOString();

  // members = COUNT(DISTINCT person_id) on the active roster. PCO models
  // assignments per (person, position), so a single person can have several
  // rows on one team. Previously the count was raw rows — Guest Experience -
  // Special showed 1289 because each person held ~6 positions on average.
  //
  // Pre-aggregate per team_id in CTEs instead of correlated subqueries.
  // Archived teams (t.archived_at IS NOT NULL) are dropped entirely —
  // they shouldn't count toward Shepherding or appear on /teams.
  //
  // "lapsed" requires evidence: at least one plan in the lapsed window for
  // this team. If no plans were scheduled in the threshold months, we can't
  // confidently say someone has dropped off — no evidence either way.
  const rows = db
    .prepare(
      `WITH roster AS (
         SELECT
           m.team_id,
           COUNT(DISTINCT m.person_id) AS members,
           COUNT(DISTINCT CASE WHEN m.is_team_leader = 1 THEN m.person_id END) AS leaders,
           COUNT(DISTINCT CASE
             WHEN m.last_served_at IS NULL OR m.last_served_at < ?
             THEN m.person_id END) AS lapsedCandidates
         FROM pco_team_memberships m
         WHERE m.org_id = ?
           AND m.archived_at IS NULL
           AND m.person_id != ''
         GROUP BY m.team_id
       ),
       served AS (
         SELECT pp.team_id, COUNT(DISTINCT pp.person_id) AS n
         FROM pco_plan_people pp
         JOIN pco_plans p
           ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
         WHERE pp.org_id = ?
           AND pp.person_id != ''
           AND p.sort_date >= ?
           AND lower(coalesce(pp.status, 'c')) NOT IN ('d', 'declined')
         GROUP BY pp.team_id
       ),
       team_plans_in_window AS (
         -- "Has this team had any plans scheduled in the lapsed window?"
         -- If not, we can't say anyone has lapsed — no evidence.
         SELECT DISTINCT pp.team_id
         FROM pco_plan_people pp
         JOIN pco_plans p
           ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
         WHERE pp.org_id = ?
           AND p.sort_date >= ?
       )
       SELECT
         t.pco_id          AS pcoId,
         t.name            AS name,
         st.name           AS serviceTypeName,
         t.archived_at     AS archivedAt,
         COALESCE(r.members, 0)  AS members,
         COALESCE(r.leaders, 0)  AS leaders,
         COALESCE(s.n, 0)        AS servedRecently,
         CASE WHEN tpw.team_id IS NOT NULL
              THEN COALESCE(r.lapsedCandidates, 0)
              ELSE 0
         END                     AS lapsed
       FROM pco_teams t
       LEFT JOIN pco_service_types st
         ON st.org_id = t.org_id AND st.pco_id = t.service_type_id
       LEFT JOIN roster r ON r.team_id = t.pco_id
       LEFT JOIN served s ON s.team_id = t.pco_id
       LEFT JOIN team_plans_in_window tpw ON tpw.team_id = t.pco_id
       WHERE t.org_id = ?
         AND t.deleted_at IS NULL
         AND t.archived_at IS NULL
         ${exclusionPlaceholders}
       ORDER BY members DESC, t.name ASC`,
    )
    .all(
      lapsedCutoff,
      orgId,
      orgId,
      activityCutoff,
      orgId,
      lapsedCutoff,
      orgId,
      ...excludedTypes,
    ) as Array<{
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

export function getTeamTotals(rows: SyncedTeamRow[]): TeamTotals {
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
