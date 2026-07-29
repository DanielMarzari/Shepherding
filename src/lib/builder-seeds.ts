import "server-only";
import { getDb } from "./db";
import type { BlockConfig, BlockKind } from "./builder";

/** One block in a seeded page definition (position is the array order). */
export interface SeedBlock {
  kind: BlockKind;
  config: BlockConfig;
}

/** A page rebuilt out of builder widgets, seeded on first visit to its route.
 *  The definitions live in version control; the moment a page exists in the DB
 *  it becomes the editable source of truth and is never re-seeded over. */
export interface SeedPage {
  slug: string;
  title: string;
  description?: string;
  /** Bump when the block definition below changes. A pristine (never-edited)
   *  seeded page is refreshed to the new definition; edited pages are left as-is. */
  revision: number;
  /** Left-nav section — usually null: overridden routes keep their existing
   *  hand-coded sidebar link, so setting this would duplicate the nav entry. */
  navSection?: string | null;
  moreSection?: string | null;
  blocks: SeedBlock[];
}

// ─── Seed definitions (one per converted page) ───────────────────────
// SQL scopes itself with :orgId (auto-bound). Ignored / excluded settings
// stored as JSON in pco_sync_settings are read back with json_each so the
// numbers match the original hand-coded pages.

const EXCLUDED_CHECKIN_EVENTS = `
  SELECT je.value FROM pco_sync_settings s,
         json_each(COALESCE(s.excluded_checkin_events, '[]')) je
   WHERE s.org_id = :orgId`;

const checkinsSeed: SeedPage = {
  slug: "checkins",
  title: "Check-ins",
  description:
    "Tag events as Kid / Adult / Ignore under Filters → Check-in events. Ignored events don't appear here.",
  revision: 4,
  blocks: [
    {
      kind: "stat",
      config: {
        title: "This week",
        span: 3,
        color: "success",
        sub: "distinct people · last 7 days",
        sql: `SELECT COUNT(DISTINCT person_id)
                FROM pco_check_ins
               WHERE org_id = :orgId
                 AND pco_created_at >= datetime('now', '-7 days')
                 AND event_id NOT IN (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Last 30 days",
        span: 3,
        sub: "distinct people · last 30 days",
        sql: `SELECT COUNT(DISTINCT person_id)
                FROM pco_check_ins
               WHERE org_id = :orgId
                 AND pco_created_at >= datetime('now', '-30 days')
                 AND event_id NOT IN (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Total people",
        span: 3,
        sub: "distinct people ever checked in",
        sql: `SELECT COUNT(DISTINCT person_id)
                FROM pco_check_ins
               WHERE org_id = :orgId
                 AND event_id NOT IN (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Ignored events",
        span: 3,
        color: "warning",
        sub: "hidden from this page",
        sql: `SELECT COUNT(*) FROM (${EXCLUDED_CHECKIN_EVENTS})`,
      },
    },
    {
      kind: "table",
      config: {
        title: "Check-in events",
        span: 12,
        density: "normal",
        columnColors: { Frequency: "low", "People (30d)": "low", "All-time": "low", "Last": "low" },
        sub: "active events · sorted by all-time check-ins (ignored events hidden)",
        sql: `WITH event_stats AS (
                SELECT event_id,
                       COUNT(*) AS total,
                       SUM(CASE WHEN pco_created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS c30,
                       COUNT(DISTINCT CASE WHEN pco_created_at >= datetime('now','-30 days') THEN person_id END) AS p30,
                       MAX(pco_created_at) AS lastAt
                  FROM pco_check_ins
                 WHERE org_id = :orgId AND event_id IS NOT NULL
                 GROUP BY event_id
              )
              SELECT e.name                        AS "Event",
                     e.frequency                   AS "Frequency",
                     COALESCE(s.c30, 0)            AS "Check-ins (30d)",
                     COALESCE(s.p30, 0)            AS "People (30d)",
                     COALESCE(s.total, 0)          AS "All-time",
                     date(s.lastAt)                AS "Last"
                FROM pco_checkin_events e
                LEFT JOIN event_stats s ON s.event_id = e.pco_id
               WHERE e.org_id = :orgId
                 AND e.archived_at IS NULL
                 AND e.pco_id NOT IN (${EXCLUDED_CHECKIN_EVENTS})
               ORDER BY "All-time" DESC, e.name ASC`,
      },
    },
  ],
};

// ── Demographics ─────────────────────────────────────────────────────
// A :scope filter (Everyone / Engaged / In groups / On teams) drives every
// chart. Each `sp` branch mirrors populatePeopleInScope() in lib/demographics.ts
// and is gated by :scope so only the selected branch returns rows.
const SCOPE_CTE = `WITH sp AS (
  SELECT pco_id AS person_id FROM pco_people
   WHERE org_id = :orgId AND :scope = 'all'
  UNION
  SELECT person_id FROM person_activity
   WHERE org_id = :orgId AND classification != 'inactive' AND :scope = 'engaged'
  UNION
  SELECT DISTINCT m.person_id FROM pco_group_memberships m
    JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND g.archived_at IS NULL AND :scope = 'groups'
  UNION
  SELECT DISTINCT m.person_id FROM pco_team_memberships m
    JOIN pco_teams t ON t.org_id = m.org_id AND t.pco_id = m.team_id
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
     AND t.archived_at IS NULL AND t.deleted_at IS NULL AND :scope = 'teams'
)`;
// Reused age-bucket ordinal (kept out of the SELECT list so charts get 2 columns).
const AGE_ORD = `CASE
  WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 99
  WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 18 THEN 1
  WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 30 THEN 2
  WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 50 THEN 3
  WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 65 THEN 4
  ELSE 5 END`;

const demographicsSeed: SeedPage = {
  slug: "demographics",
  title: "Membership demographics",
  description:
    "Who makes up the church — membership status, age, gender, and whether they have kids — for whichever slice you pick below. Drawn from PCO profile data.",
  revision: 3,
  blocks: [
    {
      kind: "filter",
      config: {
        title: "Population",
        param: "scope",
        filterType: "chips",
        defaultValue: "all",
        span: 8,
        sql: `SELECT value, label FROM (
                SELECT 1 AS o, 'all' AS value, 'Everyone' AS label
                UNION ALL SELECT 2, 'engaged', 'Engaged'
                UNION ALL SELECT 3, 'groups', 'In groups'
                UNION ALL SELECT 4, 'teams', 'On teams'
              ) ORDER BY o`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "People in this slice",
        span: 4,
        sub: "distinct people in the selected population",
        sql: `${SCOPE_CTE} SELECT COUNT(*) FROM sp`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Membership status",
        chartType: "pie",
        span: 3,
        sql: `${SCOPE_CTE}
              SELECT COALESCE(p.membership_type, '(unknown)') AS "Membership", COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id
               WHERE p.org_id = :orgId
               GROUP BY p.membership_type
               ORDER BY COUNT(*) DESC, p.membership_type ASC`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Gender",
        chartType: "bar",
        colorByCategory: true,
        span: 3,
        sql: `${SCOPE_CTE}
              SELECT CASE
                       WHEN lower(coalesce(p.gender,'')) IN ('m','male') THEN 'Male'
                       WHEN lower(coalesce(p.gender,'')) IN ('f','female') THEN 'Female'
                       ELSE 'Unknown' END AS "Gender",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id
               WHERE p.org_id = :orgId
               GROUP BY 1`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Age",
        chartType: "bar",
        colorByCategory: true,
        span: 3,
        sql: `${SCOPE_CTE}
              SELECT CASE
                       WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 'Unknown'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 18 THEN '<18'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 30 THEN '18–29'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 50 THEN '30–49'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 65 THEN '50–64'
                       ELSE '65+' END AS "Age",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id
               WHERE p.org_id = :orgId
               GROUP BY 1
               ORDER BY MIN(${AGE_ORD})`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Parents",
        chartType: "bar",
        colorByCategory: true,
        span: 3,
        sql: `${SCOPE_CTE}
              SELECT CASE WHEN p.is_parent = 1 THEN 'Parent' ELSE 'No kids' END AS "Household",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id
               WHERE p.org_id = :orgId
               GROUP BY 1`,
      },
    },
  ],
};

// ── Groups ───────────────────────────────────────────────────────────
// People currently in a non-archived group — the demographics scope for /groups.
const GROUPS_SP = `WITH sp AS (
  SELECT DISTINCT m.person_id FROM pco_group_memberships m
    JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND g.archived_at IS NULL
)`;

// Excluded group types (settings JSON) — a subquery reused as a NOT IN filter.
const EXC_GT = `SELECT je.value FROM pco_sync_settings ss, json_each(coalesce(ss.excluded_group_types, '[]')) je WHERE ss.org_id = :orgId`;

// Per-group activity/health, reproducing lib/community-lane.ts listGroups: members
// / kids / leaders, joined & left in the settings window, events, attendance, and
// the derived growing/steady/shrinking/paused state. The window + lapsed cutoffs
// come from pco_sync_settings. `base` exposes one row per active group with `state`.
const GROUPS_BASE = `WITH cutoffs AS (
    SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||COALESCE((SELECT activity_tracking_months FROM pco_sync_settings WHERE org_id=:orgId),3)||' months') AS track,
           strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||COALESCE((SELECT lapsed_weeks FROM pco_sync_settings WHERE org_id=:orgId),10)||' weeks') AS lapse
  ),
  arl AS (SELECT group_id, person_id, 1 AS active FROM pco_group_memberships WHERE org_id=:orgId AND archived_at IS NULL),
  mpg AS (
    SELECT m.group_id,
      SUM(CASE WHEN m.archived_at IS NULL THEN 1 ELSE 0 END) AS members,
      SUM(CASE WHEN m.archived_at IS NULL AND p.is_minor=1 THEN 1 ELSE 0 END) AS kids,
      SUM(CASE WHEN m.archived_at IS NULL AND lower(coalesce(m.role,'')) LIKE '%leader%' THEN 1 ELSE 0 END) AS leaders,
      SUM(CASE WHEN m.archived_at IS NULL AND m.joined_at IS NOT NULL AND m.joined_at >= (SELECT track FROM cutoffs) THEN 1 ELSE 0 END) AS joined,
      SUM(CASE WHEN m.archived_at IS NOT NULL AND m.archived_at >= (SELECT track FROM cutoffs) THEN 1 ELSE 0 END) AS archivedInWindow,
      COUNT(DISTINCT CASE WHEN m.archived_at IS NULL AND m.last_attended_at IS NOT NULL AND m.last_attended_at >= (SELECT track FROM cutoffs) AND m.last_attended_at < (SELECT lapse FROM cutoffs) THEN m.person_id END) AS lapsedCandidates
    FROM pco_group_memberships m LEFT JOIN pco_people p ON p.org_id=m.org_id AND p.pco_id=m.person_id
    WHERE m.org_id=:orgId GROUP BY m.group_id
  ),
  epg AS (SELECT group_id, COUNT(*) AS events FROM pco_group_events WHERE org_id=:orgId AND starts_at IS NOT NULL AND starts_at >= (SELECT track FROM cutoffs) GROUP BY group_id),
  apg AS (
    SELECT a.group_id,
      COUNT(DISTINCT CASE WHEN arl.active=1 THEN a.person_id END) AS attDistinct,
      COUNT(DISTINCT a.event_id) AS eventsAtt,
      COUNT(DISTINCT CASE WHEN arl.active IS NULL THEN a.person_id END) AS attendedThenGone,
      MAX(CASE WHEN a.event_starts_at >= (SELECT lapse FROM cutoffs) THEN 1 ELSE 0 END) AS takenInLapsed
    FROM pco_event_attendances a LEFT JOIN arl ON arl.group_id=a.group_id AND arl.person_id=a.person_id
    WHERE a.org_id=:orgId AND a.attended=1 AND a.event_starts_at IS NOT NULL AND a.event_starts_at >= (SELECT track FROM cutoffs)
    GROUP BY a.group_id
  ),
  derived AS (
    SELECT g.pco_id, g.name, gt.name AS type_name,
      COALESCE(mpg.members,0) AS members, COALESCE(mpg.kids,0) AS kids, COALESCE(mpg.leaders,0) AS leaders,
      COALESCE(mpg.joined,0) AS joined,
      COALESCE(mpg.archivedInWindow,0) + COALESCE(apg.attendedThenGone,0)
        + CASE WHEN COALESCE(apg.takenInLapsed,0)=1 THEN COALESCE(mpg.lapsedCandidates,0) ELSE 0 END AS leftr,
      COALESCE(epg.events,0) AS events, COALESCE(apg.attDistinct,0) AS attDistinct, COALESCE(apg.eventsAtt,0) AS eventsAtt
    FROM pco_groups g
    LEFT JOIN pco_group_types gt ON gt.org_id=g.org_id AND gt.pco_id=g.group_type_id
    LEFT JOIN mpg ON mpg.group_id=g.pco_id
    LEFT JOIN epg ON epg.group_id=g.pco_id
    LEFT JOIN apg ON apg.group_id=g.pco_id
    WHERE g.org_id=:orgId AND g.archived_at IS NULL
      AND (g.group_type_id IS NULL OR g.group_type_id NOT IN (${EXC_GT}))
  ),
  base AS (
    SELECT *, CASE
        WHEN events=0 AND members>0 THEN 'paused'
        WHEN (joined-leftr) >= 2 THEN 'growing'
        WHEN (joined-leftr) <= -2 THEN 'shrinking'
        ELSE 'steady' END AS state
    FROM derived
  )`;

// Unique people currently in a non-excluded active group (dedups across groups).
const GROUPS_ROSTER = `FROM pco_group_memberships m
    JOIN pco_groups g ON g.org_id=m.org_id AND g.pco_id=m.group_id
    LEFT JOIN pco_people p ON p.org_id=m.org_id AND p.pco_id=m.person_id
   WHERE m.org_id=:orgId AND m.archived_at IS NULL AND g.archived_at IS NULL
     AND (g.group_type_id IS NULL OR g.group_type_id NOT IN (${EXC_GT}))`;

const groupsSeed: SeedPage = {
  slug: "groups",
  title: "Groups",
  description: "Active groups, who's in them, their health, and the demographics of the people they gather.",
  revision: 4,
  blocks: [
    {
      kind: "stat",
      config: {
        title: "Active members", span: 2, sub: "unique adults in groups",
        sql: `SELECT COUNT(DISTINCT m.person_id) ${GROUPS_ROSTER} AND COALESCE(p.is_minor,0)=0`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Kids", span: 2, sub: "unique minors", color: "low",
        sql: `SELECT COUNT(DISTINCT m.person_id) ${GROUPS_ROSTER} AND p.is_minor=1`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Leaders", span: 2, sub: "unique leaders", color: "highlight",
        sql: `SELECT COUNT(DISTINCT m.person_id) ${GROUPS_ROSTER} AND lower(coalesce(m.role,'')) LIKE '%leader%'`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Leader : member", span: 2, format: "ratio", sub: "people per leader",
        sql: `SELECT
                COUNT(DISTINCT CASE WHEN lower(coalesce(m.role,'')) LIKE '%leader%' THEN m.person_id END) AS leaders,
                COUNT(DISTINCT m.person_id) AS people
              ${GROUPS_ROSTER}`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Joined · Left", span: 2, format: "list", segmentColors: ["success", "error"], sub: "in the activity window",
        sql: `${GROUPS_BASE} SELECT SUM(joined), SUM(leftr) FROM base`,
      },
    },
    {
      kind: "stat",
      config: {
        title: "Group health", span: 2, format: "list", segmentColors: ["success", "normal", "warning"], sub: "growing · steady · shrink/paused",
        sql: `${GROUPS_BASE}
              SELECT SUM(state='growing'), SUM(state='steady'), SUM(state IN ('shrinking','paused')) FROM base`,
      },
    },
    {
      kind: "table",
      config: {
        title: "Groups", span: 12, density: "normal",
        columnColors: { Type: "low", Leaders: "low", "Attend taken %": "low", Events: "low" },
        columnThresholds: { "Attend %": { base: 60, band: 15 } },
        sub: "active groups · membership, leaders, attendance, and joins/leaves in the activity window",
        sql: `${GROUPS_BASE}
              SELECT name AS "Group",
                     COALESCE(type_name, '(no type)') AS "Type",
                     state AS "State",
                     members AS "Members",
                     leaders AS "Leaders",
                     CASE WHEN events > 0 THEN round(CAST(eventsAtt AS REAL)/events*100) END AS "Attend taken %",
                     CASE WHEN eventsAtt > 0 AND members > 0 THEN min(100, round(CAST(attDistinct AS REAL)/members*100)) END AS "Attend %",
                     joined AS "Joined",
                     leftr AS "Left",
                     events AS "Events"
                FROM base
               ORDER BY members DESC, name ASC`,
      },
    },
    { kind: "divider", config: { title: "Demographics — people in groups", span: 12 } },
    {
      kind: "chart",
      config: {
        title: "Membership status", chartType: "pie", span: 3,
        sql: `${GROUPS_SP}
              SELECT COALESCE(p.membership_type, '(unknown)') AS "Membership", COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id WHERE p.org_id = :orgId
               GROUP BY p.membership_type ORDER BY COUNT(*) DESC`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Age", chartType: "bar", colorByCategory: true, span: 3,
        sql: `${GROUPS_SP}
              SELECT CASE
                       WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 'Unknown'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 18 THEN '<18'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 30 THEN '18–29'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 50 THEN '30–49'
                       WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 65 THEN '50–64'
                       ELSE '65+' END AS "Age",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id WHERE p.org_id = :orgId
               GROUP BY 1 ORDER BY MIN(${AGE_ORD})`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Gender", chartType: "bar", colorByCategory: true, span: 3,
        sql: `${GROUPS_SP}
              SELECT CASE
                       WHEN lower(coalesce(p.gender,'')) IN ('m','male') THEN 'Male'
                       WHEN lower(coalesce(p.gender,'')) IN ('f','female') THEN 'Female'
                       ELSE 'Unknown' END AS "Gender",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id WHERE p.org_id = :orgId
               GROUP BY 1`,
      },
    },
    {
      kind: "chart",
      config: {
        title: "Parents", chartType: "bar", colorByCategory: true, span: 3,
        sql: `${GROUPS_SP}
              SELECT CASE WHEN p.is_parent = 1 THEN 'Parent' ELSE 'No kids' END AS "Household",
                     COUNT(*) AS "People"
                FROM pco_people p JOIN sp ON sp.person_id = p.pco_id WHERE p.org_id = :orgId
               GROUP BY 1`,
      },
    },
    { kind: "divider", config: { title: "Attendance trend", span: 12 } },
    {
      kind: "chart",
      config: {
        title: "Group attendance", chartType: "line", span: 12,
        sql: `SELECT substr(a.event_starts_at, 1, 7) AS "Month", COUNT(DISTINCT a.person_id) AS "Attendees"
                FROM pco_event_attendances a
               WHERE a.org_id = :orgId AND a.attended = 1 AND a.event_starts_at IS NOT NULL
                 AND a.group_id IS NOT NULL
                 AND a.event_starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 months')
               GROUP BY 1 ORDER BY 1`,
      },
    },
  ],
};

// ── Teams (serving) ──────────────────────────────────────────────────
const EXC_TT = `SELECT je.value FROM pco_sync_settings ss, json_each(coalesce(ss.excluded_team_types, '[]')) je WHERE ss.org_id = :orgId`;
const TEAMS_ROSTER = `FROM pco_team_memberships m
    JOIN pco_teams t ON t.org_id = m.org_id AND t.pco_id = m.team_id
    LEFT JOIN pco_people p ON p.org_id = m.org_id AND p.pco_id = m.person_id
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
     AND t.archived_at IS NULL AND t.deleted_at IS NULL
     AND coalesce(t.service_type_id,'') NOT IN (${EXC_TT})`;
const TEAMS_SP = `WITH sp AS (
  SELECT DISTINCT m.person_id FROM pco_team_memberships m
    JOIN pco_teams t ON t.org_id = m.org_id AND t.pco_id = m.team_id
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
     AND t.archived_at IS NULL AND t.deleted_at IS NULL
)`;
// Per-team roster/serving/health, reproducing lib/serve-lane.ts listTeams
// (members/kids/leaders, served & joined in the window, lapsed, plans, and the
// growing/steady/shrinking/paused state). `base` = one row per active team.
const TEAMS_BASE = `WITH cutoffs AS (
    SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||COALESCE((SELECT activity_tracking_months FROM pco_sync_settings WHERE org_id=:orgId),3)||' months') AS act,
           strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||COALESCE((SELECT lapsed_from_team_months FROM pco_sync_settings WHERE org_id=:orgId),6)||' months') AS lapse,
           COALESCE((SELECT lapsed_from_team_events FROM pco_sync_settings WHERE org_id=:orgId),3) AS lapseEvents
  ),
  roster AS (
    SELECT m.team_id,
      COUNT(DISTINCT m.person_id) AS members,
      COUNT(DISTINCT CASE WHEN p.is_minor=1 THEN m.person_id END) AS kids,
      COUNT(DISTINCT CASE WHEN m.is_team_leader=1 THEN m.person_id END) AS leaders,
      COUNT(DISTINCT CASE WHEN m.last_served_at IS NULL OR m.last_served_at < (SELECT lapse FROM cutoffs) THEN m.person_id END) AS lapsedCandidates
    FROM pco_team_memberships m LEFT JOIN pco_people p ON p.org_id=m.org_id AND p.pco_id=m.person_id
    WHERE m.org_id=:orgId AND m.archived_at IS NULL AND m.person_id != '' GROUP BY m.team_id
  ),
  served AS (
    SELECT pp.team_id, COUNT(DISTINCT pp.person_id) AS n
    FROM pco_plan_people pp JOIN pco_plans p ON p.org_id=pp.org_id AND p.pco_id=pp.plan_id
    WHERE pp.org_id=:orgId AND pp.person_id != '' AND p.sort_date >= (SELECT act FROM cutoffs) AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
    GROUP BY pp.team_id
  ),
  tpl AS (
    SELECT pp.team_id FROM pco_plan_people pp JOIN pco_plans p ON p.org_id=pp.org_id AND p.pco_id=pp.plan_id
    WHERE pp.org_id=:orgId AND p.sort_date >= (SELECT lapse FROM cutoffs) GROUP BY pp.team_id HAVING COUNT(DISTINCT p.pco_id) >= (SELECT lapseEvents FROM cutoffs)
  ),
  tpa AS (
    SELECT pp.team_id, COUNT(DISTINCT p.pco_id) AS n FROM pco_plan_people pp JOIN pco_plans p ON p.org_id=pp.org_id AND p.pco_id=pp.plan_id
    WHERE pp.org_id=:orgId AND p.sort_date >= (SELECT act FROM cutoffs) GROUP BY pp.team_id
  ),
  fspp AS (
    SELECT pp.team_id, pp.person_id, MIN(p.sort_date) AS firstServed FROM pco_plan_people pp JOIN pco_plans p ON p.org_id=pp.org_id AND p.pco_id=pp.plan_id
    WHERE pp.org_id=:orgId AND pp.person_id != '' AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined') GROUP BY pp.team_id, pp.person_id
  ),
  joinedt AS (SELECT team_id, COUNT(*) AS n FROM fspp WHERE firstServed >= (SELECT act FROM cutoffs) GROUP BY team_id),
  derived AS (
    SELECT t.pco_id, t.name, st.name AS type_name,
      COALESCE(r.members,0) AS members, COALESCE(r.kids,0) AS kids, COALESCE(r.leaders,0) AS leaders,
      COALESCE(s.n,0) AS served, COALESCE(j.n,0) AS joined,
      CASE WHEN tpl.team_id IS NOT NULL THEN COALESCE(r.lapsedCandidates,0) ELSE 0 END AS lapsed,
      COALESCE(tpa.n,0) AS plans
    FROM pco_teams t
    LEFT JOIN pco_service_types st ON st.org_id=t.org_id AND st.pco_id=t.service_type_id
    LEFT JOIN roster r ON r.team_id=t.pco_id
    LEFT JOIN served s ON s.team_id=t.pco_id
    LEFT JOIN joinedt j ON j.team_id=t.pco_id
    LEFT JOIN tpl ON tpl.team_id=t.pco_id
    LEFT JOIN tpa ON tpa.team_id=t.pco_id
    WHERE t.org_id=:orgId AND t.deleted_at IS NULL AND t.archived_at IS NULL
      AND coalesce(t.service_type_id,'') NOT IN (${EXC_TT})
  ),
  base AS (
    SELECT *, CASE
        WHEN served=0 OR members=0 THEN 'paused'
        WHEN CAST(lapsed AS REAL)/members >= 0.5 THEN 'shrinking'
        WHEN served >= members*0.6 THEN 'growing'
        ELSE 'steady' END AS state
    FROM derived
  )`;

const teamsSeed: SeedPage = {
  slug: "teams",
  title: "Teams",
  description: "Active serving teams, their rosters and health, and the demographics of the people who serve.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "Roster size", span: 2, sub: "unique adults on team rosters",
      sql: `SELECT COUNT(DISTINCT m.person_id) ${TEAMS_ROSTER} AND COALESCE(p.is_minor,0)=0` } },
    { kind: "stat", config: { title: "Kids", span: 2, color: "low", sub: "unique minors",
      sql: `SELECT COUNT(DISTINCT m.person_id) ${TEAMS_ROSTER} AND p.is_minor=1` } },
    { kind: "stat", config: { title: "Leaders", span: 2, color: "highlight", sub: "unique team leaders",
      sql: `SELECT COUNT(DISTINCT m.person_id) ${TEAMS_ROSTER} AND m.is_team_leader=1` } },
    { kind: "stat", config: { title: "Leader : member", span: 2, format: "ratio", sub: "people per leader",
      sql: `SELECT COUNT(DISTINCT CASE WHEN m.is_team_leader=1 THEN m.person_id END) AS leaders, COUNT(DISTINCT m.person_id) AS people ${TEAMS_ROSTER}` } },
    { kind: "stat", config: { title: "Joined · Lapsed", span: 2, format: "list", segmentColors: ["success", "error"], sub: "in the activity window",
      sql: `${TEAMS_BASE} SELECT SUM(joined), SUM(lapsed) FROM base` } },
    { kind: "stat", config: { title: "Team health", span: 2, format: "list", segmentColors: ["success", "normal", "warning"], sub: "growing · steady · shrink/paused",
      sql: `${TEAMS_BASE} SELECT SUM(state='growing'), SUM(state='steady'), SUM(state IN ('shrinking','paused')) FROM base` } },
    { kind: "table", config: {
      title: "Teams", span: 12, density: "normal",
      columnColors: { "Service type": "low", Leaders: "low", Plans: "low" },
      sub: "active teams · roster, leaders, serving, joins/lapses in the activity window",
      sql: `${TEAMS_BASE}
            SELECT name AS "Team", COALESCE(type_name, '(no type)') AS "Service type", state AS "State",
                   members AS "Members", leaders AS "Leaders", served AS "Served", joined AS "Joined", lapsed AS "Lapsed", plans AS "Plans"
              FROM base ORDER BY members DESC, name ASC` } },
    { kind: "divider", config: { title: "Demographics — people on teams", span: 12 } },
    { kind: "chart", config: { title: "Membership status", chartType: "pie", span: 3,
      sql: `${TEAMS_SP} SELECT COALESCE(p.membership_type,'(unknown)') AS "Membership", COUNT(*) AS "People" FROM pco_people p JOIN sp ON sp.person_id=p.pco_id WHERE p.org_id=:orgId GROUP BY p.membership_type ORDER BY COUNT(*) DESC` } },
    { kind: "chart", config: { title: "Age", chartType: "bar", colorByCategory: true, span: 3,
      sql: `${TEAMS_SP}
            SELECT CASE
                     WHEN p.birth_year IS NULL OR p.birth_year < 1900 THEN 'Unknown'
                     WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 18 THEN '<18'
                     WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 30 THEN '18–29'
                     WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 50 THEN '30–49'
                     WHEN (CAST(strftime('%Y','now') AS INTEGER) - p.birth_year) < 65 THEN '50–64'
                     ELSE '65+' END AS "Age", COUNT(*) AS "People"
              FROM pco_people p JOIN sp ON sp.person_id=p.pco_id WHERE p.org_id=:orgId GROUP BY 1 ORDER BY MIN(${AGE_ORD})` } },
    { kind: "chart", config: { title: "Gender", chartType: "bar", colorByCategory: true, span: 3,
      sql: `${TEAMS_SP} SELECT CASE WHEN lower(coalesce(p.gender,'')) IN ('m','male') THEN 'Male' WHEN lower(coalesce(p.gender,'')) IN ('f','female') THEN 'Female' ELSE 'Unknown' END AS "Gender", COUNT(*) AS "People" FROM pco_people p JOIN sp ON sp.person_id=p.pco_id WHERE p.org_id=:orgId GROUP BY 1` } },
    { kind: "chart", config: { title: "Parents", chartType: "bar", colorByCategory: true, span: 3,
      sql: `${TEAMS_SP} SELECT CASE WHEN p.is_parent=1 THEN 'Parent' ELSE 'No kids' END AS "Household", COUNT(*) AS "People" FROM pco_people p JOIN sp ON sp.person_id=p.pco_id WHERE p.org_id=:orgId GROUP BY 1` } },
    { kind: "divider", config: { title: "Serving trend", span: 12 } },
    { kind: "chart", config: { title: "People serving", chartType: "line", span: 12,
      sql: `SELECT substr(pl.sort_date,1,7) AS "Month", COUNT(DISTINCT pp.person_id) AS "Served"
              FROM pco_plan_people pp JOIN pco_plans pl ON pl.org_id=pp.org_id AND pl.pco_id=pp.plan_id
             WHERE pp.org_id=:orgId AND pp.person_id != '' AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
               AND pl.sort_date >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 months')
             GROUP BY 1 ORDER BY 1` } },
  ],
};

// ── Home (dashboard) ─────────────────────────────────────────────────
// Aggregate counts via SQL; the people-name sections (falling through cracks,
// movement, shepherd workload) via decrypt-capable data sources.
const homeSeed: SeedPage = {
  slug: "home",
  title: "Home",
  description: "Who's drifting, who's ready for a step forward, and how the flock is moving.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "Engaged people", span: 3, sub: "adults, shepherded / active / present",
      sql: `SELECT COUNT(*) FROM person_activity pa JOIN pco_people p ON p.org_id=pa.org_id AND p.pco_id=pa.person_id
             WHERE pa.org_id=:orgId AND pa.classification IN ('shepherded','active','present') AND p.is_minor=0` } },
    { kind: "stat", config: { title: "Shepherded", span: 3, color: "success", sub: "in a group or team",
      sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='shepherded'` } },
    { kind: "stat", config: { title: "Active", span: 3, color: "warning", sub: "engaging, not yet shepherded",
      sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='active'` } },
    { kind: "stat", config: { title: "Present", span: 3, color: "low", sub: "on the books, no measured engagement",
      sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='present'` } },
    { kind: "table", config: { title: "Falling through the cracks", span: 8, density: "normal", source: "falling_through_cracks",
      columnColors: { Context: "low", "Last touch": "low" },
      columnThresholds: { "Days silent": { base: 200, band: 165, invert: true } },
      sub: "on a roster but lapsed past your thresholds" } },
    { kind: "chart", config: { title: "People mix", chartType: "donut", span: 4,
      sql: `SELECT classification AS "Mix", COUNT(*) AS "People" FROM person_activity
             WHERE org_id=:orgId AND classification IN ('shepherded','active','present')
             GROUP BY 1 ORDER BY CASE classification WHEN 'shepherded' THEN 1 WHEN 'active' THEN 2 ELSE 3 END` } },
    { kind: "table", config: { title: "Recent movement · 14 days", span: 4, density: "normal", source: "recent_movement", sub: "joins & departures" } },
    { kind: "leaderboard", config: { title: "Shepherd workload", span: 4, source: "shepherd_workload", limit: 8, sub: "top shepherds by flock size" } },
    { kind: "table", config: { title: "Group health", span: 4, density: "normal",
      columnColors: { State: "low" },
      sub: "largest active groups",
      sql: `${GROUPS_BASE} SELECT name AS "Group", members AS "Members", state AS "State" FROM base ORDER BY members DESC, name ASC LIMIT 6` } },
  ],
};

// ── People (directory) ───────────────────────────────────────────────
const peopleSeed: SeedPage = {
  slug: "people",
  title: "People",
  description: "The directory — everyone on file, their engagement classification, and where they're plugged in.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "Shepherded", span: 3, color: "success", sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='shepherded'` } },
    { kind: "stat", config: { title: "Active", span: 3, color: "warning", sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='active'` } },
    { kind: "stat", config: { title: "Present", span: 3, color: "low", sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='present'` } },
    { kind: "stat", config: { title: "Inactive", span: 3, color: "low", sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='inactive'` } },
    { kind: "table", config: { title: "Directory", span: 12, density: "normal", source: "people_directory",
      columnColors: { Membership: "low", Groups: "low", Teams: "low" },
      sub: "adults on file · sorted by engagement · first 1,000" } },
  ],
};

/** Every page rebuilt from builder widgets, keyed by slug. */
export const BUILDER_SEEDS: Record<string, SeedPage> = {
  [checkinsSeed.slug]: checkinsSeed,
  [demographicsSeed.slug]: demographicsSeed,
  [groupsSeed.slug]: groupsSeed,
  [teamsSeed.slug]: teamsSeed,
  [homeSeed.slug]: homeSeed,
  [peopleSeed.slug]: peopleSeed,
};

// ─── Seeder ──────────────────────────────────────────────────────────

function insertBlocks(db: ReturnType<typeof getDb>, orgId: number, pageId: number, seed: SeedPage): void {
  const insBlock = db.prepare(
    `INSERT INTO builder_blocks (page_id, org_id, position, kind, config) VALUES (?, ?, ?, ?, ?)`,
  );
  seed.blocks.forEach((b, i) => insBlock.run(pageId, orgId, i, b.kind, JSON.stringify(b.config)));
}

/** Ensure the seeded page for `slug` exists and, if it was never edited, is up
 *  to date with the current seed revision.
 *
 *  - Missing → create page + blocks at the seed's revision.
 *  - Present but PRISTINE (updated_at ≈ created_at) and the code seed advanced →
 *    replace its blocks with the new definition and stamp the new revision,
 *    keeping updated_at = created_at so future revisions can still refresh it.
 *  - Present and edited → left untouched, so admin edits always win.
 *  No-op for unknown slugs. */
export function ensureSeededPage(orgId: number, slug: string): void {
  const seed = BUILDER_SEEDS[slug];
  if (!seed) return;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, created_at AS createdAt, updated_at AS updatedAt, seed_revision AS seedRevision
         FROM builder_pages WHERE org_id = ? AND slug = ?`,
    )
    .get(orgId, slug) as
    | { id: number; createdAt: string; updatedAt: string; seedRevision: number | null }
    | undefined;

  if (!row) {
    const tx = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO builder_pages (org_id, slug, title, description, nav_section, more_section, seed_revision)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(orgId, seed.slug, seed.title, seed.description ?? null, seed.navSection ?? null, seed.moreSection ?? null, seed.revision);
      insertBlocks(db, orgId, Number(info.lastInsertRowid), seed);
    });
    tx();
    return;
  }

  const storedRev = row.seedRevision ?? 1;
  const editedSecs = Math.abs((new Date(row.updatedAt).getTime() - new Date(row.createdAt).getTime()) / 1000);
  const pristine = Number.isFinite(editedSecs) && editedSecs < 5;
  if (seed.revision > storedRev && pristine) {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM builder_blocks WHERE page_id = ?").run(row.id);
      insertBlocks(db, orgId, row.id, seed);
      db.prepare(
        `UPDATE builder_pages SET title = ?, description = ?, seed_revision = ?, updated_at = created_at WHERE id = ?`,
      ).run(seed.title, seed.description ?? null, seed.revision, row.id);
    });
    tx();
  }
}
