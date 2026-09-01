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
// Distinct people on a confirmed plan, last 12 months, grouped by month —
// the FROM/WHERE tail shared by the demographic serving-trend charts. Each
// chart supplies its own `substr(pl.sort_date,1,7) AS "Month"` + per-band
// COUNT(DISTINCT …) projections, mirroring AttendanceTrendCard (teams scope).
const TEAMS_SERVE_TAIL = `
    FROM pco_plan_people pp
    JOIN pco_plans pl ON pl.org_id=pp.org_id AND pl.pco_id=pp.plan_id
    JOIN pco_people p ON p.org_id=pp.org_id AND p.pco_id=pp.person_id
   WHERE pp.org_id=:orgId AND pp.person_id != '' AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
     AND pl.sort_date >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 months')
   GROUP BY 1 ORDER BY 1`;
// Reused age expression (whole years, valid birth years only).
const SERVE_AGE = `(CAST(strftime('%Y','now') AS INTEGER) - p.birth_year)`;

const teamsSeed: SeedPage = {
  slug: "teams",
  title: "Teams",
  description: "Active serving teams, their rosters and health, and the demographics of the people who serve.",
  revision: 2,
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
    { kind: "divider", config: { title: "Serving trends across demographics", span: 12, sub: "distinct people on a confirmed plan per month · last 12 months" } },
    { kind: "chart", config: { title: "People serving", chartType: "line", span: 12,
      sql: `SELECT substr(pl.sort_date,1,7) AS "Month", COUNT(DISTINCT pp.person_id) AS "Served" ${TEAMS_SERVE_TAIL}` } },
    { kind: "chart", config: { title: "Serving by age", chartType: "line", span: 4,
      sql: `SELECT substr(pl.sort_date,1,7) AS "Month",
              COUNT(DISTINCT CASE WHEN p.birth_year>=1900 AND ${SERVE_AGE} < 30 THEN pp.person_id END) AS "Under 30",
              COUNT(DISTINCT CASE WHEN p.birth_year>=1900 AND ${SERVE_AGE} BETWEEN 30 AND 49 THEN pp.person_id END) AS "30–49",
              COUNT(DISTINCT CASE WHEN p.birth_year>=1900 AND ${SERVE_AGE} BETWEEN 50 AND 64 THEN pp.person_id END) AS "50–64",
              COUNT(DISTINCT CASE WHEN p.birth_year>=1900 AND ${SERVE_AGE} >= 65 THEN pp.person_id END) AS "65+",
              COUNT(DISTINCT CASE WHEN p.birth_year IS NULL OR p.birth_year<1900 THEN pp.person_id END) AS "Unknown"
              ${TEAMS_SERVE_TAIL}` } },
    { kind: "chart", config: { title: "Serving by gender", chartType: "line", span: 4,
      sql: `SELECT substr(pl.sort_date,1,7) AS "Month",
              COUNT(DISTINCT CASE WHEN lower(coalesce(p.gender,'')) IN ('m','male') THEN pp.person_id END) AS "Male",
              COUNT(DISTINCT CASE WHEN lower(coalesce(p.gender,'')) IN ('f','female') THEN pp.person_id END) AS "Female",
              COUNT(DISTINCT CASE WHEN lower(coalesce(p.gender,'')) NOT IN ('m','male','f','female') THEN pp.person_id END) AS "Unknown"
              ${TEAMS_SERVE_TAIL}` } },
    { kind: "chart", config: { title: "Serving by parent status", chartType: "line", span: 4,
      sql: `SELECT substr(pl.sort_date,1,7) AS "Month",
              COUNT(DISTINCT CASE WHEN p.is_parent=1 AND coalesce(p.is_minor,0)=0 THEN pp.person_id END) AS "Has kids",
              COUNT(DISTINCT CASE WHEN coalesce(p.is_parent,0)=0 AND coalesce(p.is_minor,0)=0 THEN pp.person_id END) AS "No kids",
              COUNT(DISTINCT CASE WHEN p.is_minor=1 THEN pp.person_id END) AS "Minor"
              ${TEAMS_SERVE_TAIL}` } },
  ],
};

// ── Home (dashboard) ─────────────────────────────────────────────────
// Aggregate counts via SQL; the people-name sections (falling through cracks,
// movement, shepherd workload) via decrypt-capable data sources.
const homeSeed: SeedPage = {
  slug: "home",
  title: "Home",
  description: "Who's drifting, who's ready for a step forward, and how the flock is moving.",
  revision: 2,
  blocks: [
    { kind: "stat", config: { title: "Engaged people", span: 4, sub: "adults, shepherded / active / present",
      sql: `SELECT COUNT(*) FROM person_activity pa JOIN pco_people p ON p.org_id=pa.org_id AND p.pco_id=pa.person_id
             WHERE pa.org_id=:orgId AND pa.classification IN ('shepherded','active','present') AND p.is_minor=0` } },
    { kind: "stat", config: { title: "Shepherded", span: 2, color: "success", sub: "in a group/team",
      sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='shepherded'` } },
    { kind: "stat", config: { title: "Active", span: 2, color: "warning", sub: "not yet shepherded",
      sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='active'` } },
    { kind: "stat", config: { title: "Present", span: 2, color: "low", sub: "no engagement",
      sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='present'` } },
    { kind: "stat", config: { title: "Unshepherded", span: 2, color: "warning", sub: "active + present adults",
      sql: `SELECT COUNT(*) FROM person_activity pa JOIN pco_people p ON p.org_id=pa.org_id AND p.pco_id=pa.person_id
             WHERE pa.org_id=:orgId AND pa.classification IN ('active','present') AND p.is_minor=0` } },
    { kind: "table", config: { title: "Falling through the cracks", span: 8, density: "normal", source: "falling_through_cracks", limit: 8,
      columnColors: { Context: "low", "Last touch": "low" },
      columnThresholds: { "Days silent": { base: 200, band: 165, invert: true } },
      sub: "on a roster but lapsed past your thresholds · top 8" } },
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
  revision: 2,
  blocks: [
    { kind: "stat", config: { title: "Shepherded", span: 3, color: "success", sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='shepherded'` } },
    { kind: "stat", config: { title: "Active", span: 3, color: "warning", sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='active'` } },
    { kind: "stat", config: { title: "Present", span: 3, color: "low", sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='present'` } },
    { kind: "stat", config: { title: "Inactive", span: 3, color: "low", sql: `SELECT COUNT(*) FROM person_activity WHERE org_id=:orgId AND classification='inactive'` } },
    { kind: "filter", config: { title: "Show", span: 12, param: "classification", filterType: "tabs",
      sql: `SELECT value, label FROM (
              SELECT 1 AS o, 'shepherded' AS value, 'Shepherded' AS label
              UNION ALL SELECT 2, 'active', 'Active'
              UNION ALL SELECT 3, 'present', 'Present'
              UNION ALL SELECT 4, 'inactive', 'Inactive'
            ) ORDER BY o` } },
    { kind: "table", config: { title: "Directory", span: 12, density: "normal", source: "people_directory", sortable: true, limit: 200,
      columnColors: { Membership: "low", Groups: "low", Teams: "low" },
      sub: "adults on file · sorted by engagement · first 1,000 (All = everyone engaged)" } },
  ],
};

const staffSeed: SeedPage = {
  slug: "staff",
  title: "Church staff",
  description: "People on the church staff reference list.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "Staff", span: 3, sub: "on the staff reference list",
      sql: `SELECT COUNT(*) FROM pco_list_memberships lm JOIN pco_lists l ON l.org_id=lm.org_id AND l.pco_id=lm.list_id
             WHERE lm.org_id=:orgId AND l.name='REFERENCE - Church Staff'` } },
    { kind: "table", config: { title: "Staff directory", span: 12, density: "normal", source: "staff_directory",
      columnColors: { Membership: "low", Engagement: "low" } } },
  ],
};

// ── Shepherds (leader oversight) ─────────────────────────────────────
// Names + overseer graph via the decrypt-capable shepherds sources.
const shepherdsSeed: SeedPage = {
  slug: "shepherds",
  title: "Shepherds",
  description: "Everyone leading a group or team, and who on the shepherd team oversees them. \"Needs mapping\" rows have no overseer yet.",
  revision: 2,
  blocks: [
    { kind: "stat", config: { title: "Shepherds", span: 4, source: "shepherds_overview", valueColumn: 0, sub: "leading a group or team" } },
    { kind: "stat", config: { title: "Overseen", span: 4, color: "success", source: "shepherds_overview", valueColumn: 1, sub: "have a shepherd-team overseer" } },
    { kind: "stat", config: { title: "Needs mapping", span: 4, color: "warning", source: "shepherds_overview", valueColumn: 2, sub: "no overseer yet — set on the shepherd map" } },
    { kind: "table", config: { title: "Shepherds", span: 12, density: "normal", source: "shepherds_directory", sortable: true,
      chipColumns: ["Groups led", "Teams led", "Overseen by"],
      sub: "leaders first that still need an overseer mapped · then the lead pastor · then the overseen" } },
  ],
};

// ── Shepherd team (four-bucket reach) ────────────────────────────────
const shepherdTeamSeed: SeedPage = {
  slug: "shepherd-team",
  title: "Shepherd team",
  description: "The people on the \"REFERENCE - Shepherd Team\" list and each one's direct reach, split into four non-overlapping buckets.",
  revision: 2,
  blocks: [
    { kind: "stat", config: { title: "Team members", span: 3, sub: "on the shepherd team list",
      sql: `SELECT COUNT(*) FROM pco_list_memberships lm JOIN pco_lists l ON l.org_id=lm.org_id AND l.pco_id=lm.list_id
             WHERE lm.org_id=:orgId AND l.name='REFERENCE - Shepherd Team'` } },
    { kind: "table", config: { title: "Reach by shepherd", span: 12, density: "normal", source: "shepherd_team_directory", sortable: true,
      columnColors: { Membership: "low" }, chipColumns: ["Assignments"],
      sub: "assignments (shepherd-map targets) + distinct people reached · volunteer leaders → congregants → care → staff (non-overlapping) · sorted by total reach" } },
  ],
};

// ── Duplicate audit (from the See More menu) ─────────────────────────
const duplicatesSeed: SeedPage = {
  slug: "audit-duplicates",
  title: "Duplicate audit",
  description: "People who likely appear twice — matched on exact name and fuzzily (shared email, birthdate, or address). Active + inactive pairs often mean someone is returning.",
  revision: 2,
  blocks: [
    { kind: "stat", config: { title: "Duplicate pairs", span: 3, source: "duplicate_overview", valueColumn: 0, sub: "likely appear twice" } },
    { kind: "stat", config: { title: "High confidence", span: 3, color: "warning", source: "duplicate_overview", valueColumn: 1, sub: "exact-name match" } },
    { kind: "stat", config: { title: "Low confidence", span: 3, color: "low", source: "duplicate_overview", valueColumn: 2, sub: "fuzzy / shared signal" } },
    { kind: "stat", config: { title: "Possibly returning", span: 3, color: "highlight", source: "duplicate_overview", valueColumn: 3, sub: "one active + one inactive" } },
    { kind: "filter", config: { title: "Confidence", span: 12, param: "confidence", filterType: "chips",
      sql: `SELECT value, label FROM (
              SELECT 1 AS o, 'high' AS value, 'High confidence' AS label
              UNION ALL SELECT 2, 'low', 'Low confidence'
            ) ORDER BY o` } },
    { kind: "linkcard", config: { title: "Likely duplicates", span: 12, source: "duplicate_pairs", limit: 200,
      sub: "each pair links out to PCO — matched on name + a shared email / birthdate / address · fix upstream in PCO" } },
  ],
};

// ── Membership audit (from the See More menu) ────────────────────────
const membershipAuditSeed: SeedPage = {
  slug: "audit-membership",
  title: "Membership audit",
  description: "Rows in a membership type that look wrong — deceased, long-inactive, junk names, possible duplicates. Fix them upstream in PCO; this page never writes back.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "Flagged", span: 3, color: "warning", source: "membership_audit_overview", valueColumn: 0, sub: "rows with ≥1 issue" } },
    { kind: "stat", config: { title: "Scanned", span: 3, color: "low", source: "membership_audit_overview", valueColumn: 1, sub: "in the selected type" } },
    { kind: "filter", config: { title: "Membership type", span: 3, param: "membership_type", filterType: "dropdown", defaultValue: "Member",
      sql: `SELECT DISTINCT membership_type FROM pco_people
             WHERE org_id=:orgId AND membership_type IS NOT NULL AND trim(membership_type) != '' ORDER BY 1` } },
    { kind: "filter", config: { title: "Issue", span: 3, param: "flag", filterType: "chips",
      sql: `SELECT value, label FROM (
              SELECT 1 AS o, 'deceased' AS value, 'Deceased' AS label
              UNION ALL SELECT 2, 'inactive', 'Inactive'
              UNION ALL SELECT 3, 'junk-name', 'Junk name'
              UNION ALL SELECT 4, 'weird-name', 'Weird name'
              UNION ALL SELECT 5, 'possible-duplicate', 'Possible duplicate'
              UNION ALL SELECT 6, 'stale-pco-record', 'Stale 6mo+'
              UNION ALL SELECT 7, 'no-activity-no-rosters', 'No activity'
            ) ORDER BY o` } },
    { kind: "linkcard", config: { title: "Flagged people", span: 12, source: "membership_audit", limit: 300,
      sub: "each links to their PCO profile · tags show why it was flagged" } },
  ],
};

// ── Name audit (from the See More menu) ──────────────────────────────
const nameAuditSeed: SeedPage = {
  slug: "audit-names",
  title: "Name audit",
  description: "People whose names look like junk or data-entry noise (all caps, symbols, a single letter, obvious placeholders). Fix them in PCO.",
  revision: 1,
  blocks: [
    { kind: "linkcard", config: { title: "Name issues", span: 12, source: "name_audit", limit: 400,
      sub: "junk / weird names across every membership type · each links to PCO" } },
  ],
};

// ── Member map (from the See More menu) ──────────────────────────────
// Static approximation of the interactive /map: plots geocoded members and
// summarizes coverage. The drag-to-test second-campus tooling stays on /map.
const memberMapSeed: SeedPage = {
  slug: "member-map",
  title: "Member map",
  description: "Where geocoded members live, colored intent aside. A static view — the interactive reach / second-campus tooling stays on the original Map page.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "Mapped members", span: 4, sub: "geocoded to a home location",
      sql: `SELECT COUNT(*) FROM person_geo WHERE org_id=:orgId AND status='ok' AND lat IS NOT NULL` } },
    { kind: "chart", config: { title: "Mapped by engagement", chartType: "donut", span: 8,
      sql: `SELECT COALESCE(pa.classification,'inactive') AS "Engagement", COUNT(*) AS "People"
              FROM person_geo g LEFT JOIN person_activity pa ON pa.org_id=g.org_id AND pa.person_id=g.person_id
             WHERE g.org_id=:orgId AND g.status='ok' AND g.lat IS NOT NULL
             GROUP BY 1 ORDER BY 2 DESC` } },
    { kind: "map", config: { title: "Members", span: 12, height: "double",
      sql: `SELECT g.lat, g.lng, COALESCE(pa.classification,'inactive') AS "Engagement"
              FROM person_geo g LEFT JOIN person_activity pa ON pa.org_id=g.org_id AND pa.person_id=g.person_id
             WHERE g.org_id=:orgId AND g.status='ok' AND g.lat IS NOT NULL
             LIMIT 4000` } },
  ],
};

// ── Attendance (weekly trend) ────────────────────────────────────────
// The SQL-able core of /attendance (imported weekly + per-service counts).
// The weather / forecast / seasonal / preacher analytics stay on the original.
const attendanceSeed: SeedPage = {
  slug: "attendance",
  title: "Attendance",
  description: "Weekly worship attendance from the imported rollups — in-person vs online, the congregation mix, and by room. Weather / forecast / preacher analytics stay on the original page.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "In-person · 12mo avg", span: 3, sub: "weekly total",
      sql: `SELECT ROUND(AVG(in_person_total)) FROM attendance_weekly
             WHERE org_id=:orgId AND in_person_total IS NOT NULL AND week_date >= date('now','-12 months')` } },
    { kind: "stat", config: { title: "Peak week", span: 3, color: "success", sub: "highest in-person week, 12mo",
      sql: `SELECT MAX(in_person_total) FROM attendance_weekly
             WHERE org_id=:orgId AND week_date >= date('now','-12 months')` } },
    { kind: "stat", config: { title: "Online live · 12mo avg", span: 3, color: "low", sub: "weekly livestream",
      sql: `SELECT ROUND(AVG(online_live)) FROM attendance_weekly
             WHERE org_id=:orgId AND online_live IS NOT NULL AND week_date >= date('now','-12 months')` } },
    { kind: "stat", config: { title: "Weeks on file", span: 3, color: "low", sub: "imported rollups",
      sql: `SELECT COUNT(*) FROM attendance_weekly WHERE org_id=:orgId` } },
    { kind: "chart", config: { title: "Attendance over time", chartType: "line", span: 12,
      sql: `SELECT week_date AS "Week", in_person_total AS "In person", online_live AS "Online live"
              FROM attendance_weekly WHERE org_id=:orgId AND week_date >= date('now','-24 months') ORDER BY week_date` } },
    { kind: "chart", config: { title: "Congregation mix", chartType: "line", span: 6,
      sql: `SELECT week_date AS "Week", adult_total AS "Adults", student_total AS "Students", kids_total AS "Kids"
              FROM attendance_weekly WHERE org_id=:orgId AND week_date >= date('now','-24 months') ORDER BY week_date` } },
    { kind: "chart", config: { title: "By room · last 3 months", chartType: "bar", colorByCategory: true, span: 6,
      sql: `SELECT room AS "Room", SUM(count) AS "Attendance"
              FROM attendance_service WHERE org_id=:orgId AND week_date >= date('now','-3 months')
             GROUP BY room ORDER BY 2 DESC` } },
  ],
};

// ── Relationship graph (network) ─────────────────────────────────────
const relationshipGraphSeed: SeedPage = {
  slug: "relationship-graph",
  title: "Relationship graph",
  description: "Everyone engaged, linked by the groups and teams they share and the oversight between them. Drag nodes, zoom, and hover — the force graph is interactive.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "People on graph", span: 3, source: "relationship_graph_overview", valueColumn: 0, sub: "engaged + leadership" } },
    { kind: "stat", config: { title: "Connections", span: 3, color: "low", source: "relationship_graph_overview", valueColumn: 1, sub: "shared group/team + oversight" } },
    { kind: "stat", config: { title: "Shepherded", span: 3, color: "success", source: "relationship_graph_overview", valueColumn: 2, sub: "in a group or team" } },
    { kind: "stat", config: { title: "Active", span: 3, color: "warning", source: "relationship_graph_overview", valueColumn: 3, sub: "engaging, not yet shepherded" } },
    { kind: "chart", config: { title: "Relationship web", chartType: "network", span: 12, height: "triple", source: "relationship_graph",
      sub: "drag / zoom / hover · capped at 2,500 connections for responsiveness" } },
  ],
};

// ── Who-knows-who (intake network) ───────────────────────────────────
const whoKnowsWhoSeed: SeedPage = {
  slug: "who-knows-who",
  title: "Who knows who",
  description: "The intake web — who on the shepherd team said they know each active / present person. Interactive force graph.",
  revision: 1,
  blocks: [
    { kind: "filter", config: { title: "Pool", span: 12, param: "source", filterType: "tabs", defaultValue: "know",
      sql: `SELECT value, label FROM (
              SELECT 1 AS o, 'know' AS value, 'Active pool (know)' AS label
              UNION ALL SELECT 2, 'present', 'Present pool'
            ) ORDER BY o` } },
    { kind: "chart", config: { title: "Who knows who", chartType: "network", span: 12, height: "triple", source: "intake_graph",
      sub: "shepherd → the person they marked · drag / zoom / hover" } },
  ],
};

// ── Email dashboard (Constant Contact) ───────────────────────────────
// All SQL against the synced cc_* tables — no OAuth needed at view time.
const emailDashboardSeed: SeedPage = {
  slug: "email-dashboard",
  title: "Email dashboard",
  description: "Constant Contact at a glance — audience size, send performance over time, and per-campaign open / click / bounce rates. From the synced data.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "Contacts", span: 3, sub: "in Constant Contact",
      sql: `SELECT COUNT(*) FROM cc_contacts WHERE org_id=:orgId` } },
    { kind: "stat", config: { title: "Campaigns sent", span: 3, color: "low", sub: "with send stats",
      sql: `SELECT COUNT(*) FROM cc_campaigns WHERE org_id=:orgId AND stat_sends>0` } },
    { kind: "stat", config: { title: "Avg open %", span: 3, color: "success", sub: "opens ÷ sends, all campaigns",
      sql: `SELECT ROUND(100.0*SUM(stat_opens)/NULLIF(SUM(stat_sends),0),1) FROM cc_campaigns WHERE org_id=:orgId AND stat_sends>0` } },
    { kind: "stat", config: { title: "Avg click %", span: 3, color: "warning", sub: "clicks ÷ sends",
      sql: `SELECT ROUND(100.0*SUM(stat_clicks)/NULLIF(SUM(stat_sends),0),1) FROM cc_campaigns WHERE org_id=:orgId AND stat_sends>0` } },
    { kind: "chart", config: { title: "Open / Click % over time", chartType: "line", span: 8,
      sql: `SELECT substr(last_sent_date,1,7) AS "Month",
              ROUND(100.0*SUM(stat_opens)/NULLIF(SUM(stat_sends),0),1) AS "Open %",
              ROUND(100.0*SUM(stat_clicks)/NULLIF(SUM(stat_sends),0),1) AS "Click %"
              FROM cc_campaigns WHERE org_id=:orgId AND stat_sends>0 AND last_sent_date IS NOT NULL
             GROUP BY 1 ORDER BY 1` } },
    { kind: "chart", config: { title: "New contacts by month", chartType: "bar", span: 4,
      sql: `SELECT substr(created_at,1,7) AS "Month", COUNT(*) AS "New"
              FROM cc_contacts WHERE org_id=:orgId AND created_at IS NOT NULL AND created_at >= date('now','-24 months')
             GROUP BY 1 ORDER BY 1` } },
    { kind: "table", config: { title: "Campaign performance", span: 12, density: "normal", sortable: true, limit: 100,
      columnColors: { Status: "low", Sent: "low" },
      columnThresholds: { "Open %": { base: 35, band: 10 }, "Click %": { base: 5, band: 3 }, "Bounce %": { base: 2, band: 1, invert: true } },
      sub: "most recent first · open/click green above target, bounce red when high",
      sql: `SELECT name AS "Campaign", current_status AS "Status", substr(last_sent_date,1,10) AS "Sent",
                   stat_sends AS "Sends",
                   ROUND(100.0*stat_opens/NULLIF(stat_sends,0),1) AS "Open %",
                   ROUND(100.0*stat_clicks/NULLIF(stat_sends,0),1) AS "Click %",
                   ROUND(100.0*stat_bounces/NULLIF(stat_sends,0),1) AS "Bounce %"
              FROM cc_campaigns WHERE org_id=:orgId AND stat_sends>0
             ORDER BY last_sent_date DESC LIMIT 100` } },
  ],
};

// ── Retention ────────────────────────────────────────────────────────
const retentionSeed: SeedPage = {
  slug: "retention",
  title: "Retention",
  description: "How well engaged people stick — retention by join year, the calendar-month seasonality, and per-cohort decay. Wraps the same math as the original page.",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "Retention", span: 3, format: "number", source: "retention_overview", valueColumn: 0, sub: "% of settled cohorts still engaged" } },
    { kind: "stat", config: { title: "Joined", span: 3, color: "low", source: "retention_overview", valueColumn: 1, sub: "settled cohorts" } },
    { kind: "stat", config: { title: "Retained", span: 3, color: "success", source: "retention_overview", valueColumn: 2, sub: "still engaged" } },
    { kind: "stat", config: { title: "Annual decay", span: 3, color: "warning", source: "retention_overview", valueColumn: 3, sub: "% lost per year" } },
    { kind: "chart", config: { title: "Retention by join year", chartType: "bar", colorByCategory: true, span: 6, source: "retention_by_year" } },
    { kind: "chart", config: { title: "Retention by month joined", chartType: "bar", colorByCategory: true, span: 6, source: "retention_seasonality" } },
    { kind: "chart", config: { title: "Cohort decay", chartType: "heatmap", span: 12, height: "double", source: "retention_decay",
      sub: "each join-year cohort (row) and how much of it is still engaged as of each later year (column)" } },
  ],
};

// ── Group pipeline ───────────────────────────────────────────────────
const pipelineSeed: SeedPage = {
  slug: "group-pipeline",
  title: "Group pipeline",
  description: "How long people take to move from applying to a group, to joining, to showing up — overall, by group type, over time, and where the time goes. (The serving pipeline stays on the original page.)",
  revision: 1,
  blocks: [
    { kind: "stat", config: { title: "People", span: 3, source: "pipeline_overview", valueColumn: 0, sub: "with a measurable journey" } },
    { kind: "stat", config: { title: "Apply → join", span: 3, color: "warning", source: "pipeline_overview", valueColumn: 1, sub: "median days" } },
    { kind: "stat", config: { title: "Join → attend", span: 3, color: "warning", source: "pipeline_overview", valueColumn: 2, sub: "median days" } },
    { kind: "stat", config: { title: "Overall", span: 3, color: "low", source: "pipeline_overview", valueColumn: 3, sub: "median days end-to-end" } },
    { kind: "chart", config: { title: "Median days over time", chartType: "line", span: 8, source: "pipeline_history" } },
    { kind: "chart", config: { title: "Where the time goes", chartType: "bubble", span: 4, source: "pipeline_stage_points",
      sub: "apply→join (x) vs join→attend (y) days" } },
    { kind: "table", config: { title: "By group type", span: 12, density: "normal", sortable: true, source: "pipeline_by_type",
      columnThresholds: { "Median days": { base: 30, band: 20, invert: true }, "P75 days": { base: 60, band: 30, invert: true } },
      sub: "faster (fewer days) is greener" } },
  ],
};

// ── Giving (imported PushPay donors) ─────────────────────────────────
// Aggregates run as plain read-only SQL against pushpay_donors (joined to
// pco_people / person_geo). Name-bearing tables use the decrypt-capable
// giving_directory / giving_lapsed sources, since builder SQL can't read
// encrypted PII. Donor stage buckets are matched loosely (LIKE) because the
// export's wording varies (Recurring / Regular Giver / Lapsed Donor / …).
const GIVERS = `SELECT COUNT(DISTINCT person_id) FROM pushpay_donors WHERE org_id=:orgId AND person_id IS NOT NULL`;
const givingSeed: SeedPage = {
  slug: "giving",
  title: "Giving statistics",
  description:
    "Giving from the imported PushPay donor export — who gives, membership vs. giving coverage, donor stages, funds, channels, where givers live, and recency. Import or refresh on the PushPay page.",
  revision: 1,
  moreSection: "Reports & insights",
  blocks: [
    { kind: "stat", config: { title: "Givers", span: 2, sub: "people who have given", sql: GIVERS } },
    { kind: "stat", config: { title: "Recurring", span: 2, color: "success", sub: "regular / scheduled",
      sql: `${GIVERS} AND (lower(donor_stage) LIKE '%recurring%' OR lower(donor_stage) LIKE '%regular%')` } },
    { kind: "stat", config: { title: "Lapsed", span: 2, color: "warning", sub: "stopped giving",
      sql: `${GIVERS} AND lower(donor_stage) LIKE '%lapsed%'` } },
    { kind: "stat", config: { title: "First-time", span: 2, color: "highlight", sub: "new donors",
      sql: `${GIVERS} AND (lower(donor_stage) LIKE '%first%' OR lower(donor_stage) LIKE '%new%')` } },
    { kind: "stat", config: { title: "Donor records", span: 2, color: "low", sub: "rows in the export",
      sql: `SELECT COUNT(*) FROM pushpay_donors WHERE org_id=:orgId` } },
    { kind: "stat", config: { title: "Unlinked", span: 2, color: "low", sub: "not tied to a person yet",
      sql: `SELECT COUNT(*) FROM pushpay_donors WHERE org_id=:orgId AND person_id IS NULL` } },

    { kind: "divider", config: { title: "Membership vs. giving", span: 12 } },
    { kind: "chart", config: { title: "Givers by membership", chartType: "bar", colorByCategory: true, span: 6,
      sql: `SELECT COALESCE(p.membership_type,'(none)') AS "Membership", COUNT(DISTINCT d.person_id) AS "Givers"
              FROM pushpay_donors d JOIN pco_people p ON p.org_id=d.org_id AND p.pco_id=d.person_id
             WHERE d.org_id=:orgId AND d.person_id IS NOT NULL
             GROUP BY 1 ORDER BY 2 DESC` } },
    { kind: "table", config: { title: "Giving coverage by membership", span: 6, density: "condensed",
      sub: "what share of each membership type has given",
      sql: `WITH givers AS (SELECT DISTINCT person_id FROM pushpay_donors WHERE org_id=:orgId AND person_id IS NOT NULL)
            SELECT COALESCE(p.membership_type,'(none)') AS "Membership",
                   COUNT(*) AS "People",
                   COUNT(g.person_id) AS "Givers",
                   round(CAST(COUNT(g.person_id) AS REAL)/COUNT(*)*100) AS "Coverage %"
              FROM pco_people p
              LEFT JOIN givers g ON g.person_id=p.pco_id
             WHERE p.org_id=:orgId AND p.is_minor=0
               AND (p.membership_type IS NULL OR lower(p.membership_type) NOT LIKE '%system use%')
             GROUP BY 1 ORDER BY COUNT(g.person_id) DESC` } },

    { kind: "divider", config: { title: "Giving mix", span: 12 } },
    { kind: "chart", config: { title: "Donor stage", chartType: "bar", colorByCategory: true, span: 4,
      sql: `SELECT COALESCE(donor_stage,'(unknown)') AS "Stage", COUNT(*) AS "Donors"
              FROM pushpay_donors WHERE org_id=:orgId GROUP BY 1 ORDER BY 2 DESC` } },
    { kind: "chart", config: { title: "Last gift fund", chartType: "bar", colorByCategory: true, span: 4,
      sql: `SELECT COALESCE(last_gift_fund,'(none)') AS "Fund", COUNT(*) AS "Gifts"
              FROM pushpay_donors WHERE org_id=:orgId GROUP BY 1 ORDER BY 2 DESC LIMIT 12` } },
    { kind: "chart", config: { title: "Giving channel", chartType: "donut", span: 4,
      sql: `SELECT COALESCE(giving_channel,'(unknown)') AS "Channel", COUNT(*) AS "Donors"
              FROM pushpay_donors WHERE org_id=:orgId GROUP BY 1 ORDER BY 2 DESC` } },

    { kind: "divider", config: { title: "Where givers live", span: 12 } },
    { kind: "stat", config: { title: "Givers mapped", span: 4, sub: "geocoded to a home",
      sql: `SELECT COUNT(DISTINCT d.person_id)
              FROM pushpay_donors d JOIN person_geo g ON g.org_id=d.org_id AND g.person_id=d.person_id
             WHERE d.org_id=:orgId AND d.person_id IS NOT NULL AND g.status='ok' AND g.lat IS NOT NULL` } },
    { kind: "map", config: { title: "Givers", span: 8, height: "double",
      sql: `SELECT g.lat, g.lng, MAX(COALESCE(d.donor_stage,'Donor')) AS "Stage"
              FROM pushpay_donors d JOIN person_geo g ON g.org_id=d.org_id AND g.person_id=d.person_id
             WHERE d.org_id=:orgId AND d.person_id IS NOT NULL AND g.status='ok' AND g.lat IS NOT NULL
             GROUP BY d.person_id, g.lat, g.lng LIMIT 4000` } },

    { kind: "divider", config: { title: "Recency", span: 12 } },
    { kind: "chart", config: { title: "Most recent gift by month", chartType: "line", span: 12,
      sub: "the export carries each donor's last gift only — this is when people most recently gave",
      sql: `SELECT substr(last_gift_date,1,7) AS "Month", COUNT(*) AS "Donors"
              FROM pushpay_donors WHERE org_id=:orgId AND last_gift_date IS NOT NULL AND length(last_gift_date)>=7
             GROUP BY 1 ORDER BY 1` } },

    { kind: "divider", config: { title: "Donors", span: 12 } },
    { kind: "table", config: { title: "Giving directory", span: 12, density: "normal", sortable: true,
      source: "giving_directory", sub: "one row per giver, most recent gift" } },
    { kind: "table", config: { title: "Lapsed givers to reconnect", span: 12, density: "condensed", sortable: true,
      source: "giving_lapsed", sub: "givers whose donor stage reads as lapsed" } },
  ],
};

/** Every page rebuilt from builder widgets, keyed by slug. */
export const BUILDER_SEEDS: Record<string, SeedPage> = {
  [givingSeed.slug]: givingSeed,
  [checkinsSeed.slug]: checkinsSeed,
  [demographicsSeed.slug]: demographicsSeed,
  [groupsSeed.slug]: groupsSeed,
  [teamsSeed.slug]: teamsSeed,
  [homeSeed.slug]: homeSeed,
  [peopleSeed.slug]: peopleSeed,
  [staffSeed.slug]: staffSeed,
  [shepherdsSeed.slug]: shepherdsSeed,
  [shepherdTeamSeed.slug]: shepherdTeamSeed,
  [duplicatesSeed.slug]: duplicatesSeed,
  [membershipAuditSeed.slug]: membershipAuditSeed,
  [nameAuditSeed.slug]: nameAuditSeed,
  [memberMapSeed.slug]: memberMapSeed,
  [attendanceSeed.slug]: attendanceSeed,
  [relationshipGraphSeed.slug]: relationshipGraphSeed,
  [whoKnowsWhoSeed.slug]: whoKnowsWhoSeed,
  [emailDashboardSeed.slug]: emailDashboardSeed,
  [retentionSeed.slug]: retentionSeed,
  [pipelineSeed.slug]: pipelineSeed,
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
