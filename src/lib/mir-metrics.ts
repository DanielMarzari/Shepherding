import "server-only";
import type { SeedBlock } from "./builder-seeds";
import type { MirExtras } from "./mir-seeds";

// Live metrics for the Ministry Impact Report pages — the "Outputs" column of
// each Logic Model, which the report itself calls "the story of ministry impact
// through numbers".
//
// Every query here was run against the production database before it was
// written down, and every number it returns was checked for plausibility. A
// ministry with no entry in MIR_EXTRAS renders its published Outputs as text and
// says so; that is the honest default, not an oversight. Where a metric counts
// something adjacent to the published Output rather than the Output itself, the
// label says which — a count of volunteers scheduled is not a count of people
// served, and we do not let one stand in for the other.
//
// Ministries deliberately left unmeasured: Anathallo (its data lives in an
// external EHR), Contracts, Human Resources, Reception, Information Technology,
// Facilities, Finance-adjacent admin, Christmas Tree Lighting, Global Outreach,
// Local Outreach, Spanish Language Opportunities, Unreached Language Group,
// Faith Preschool, Care Groups (the "Care Ministries" group type exists in PCO
// but has no members), and the Communications/Technology/Worship pages not
// listed below.

// ─── Shared SQL fragments ────────────────────────────────────────────

/** Adults engaged with Faith Church — the denominator for "% of congregation".
 *  Not a raw people count: ~64% of PCO records are inactive. */
const ENGAGED_ADULTS = `
  SELECT p.pco_id
    FROM pco_people p
    JOIN person_activity pa ON pa.person_id = p.pco_id AND pa.org_id = :orgId
   WHERE p.org_id = :orgId AND p.is_minor = 0
     AND pa.classification IN ('shepherded','active','present')`;

const ADULT_DISCIPLESHIP_TYPES = `
  'Small Groups','Disciple-making Groups','ABF Groups',
  'Women''s AM Bible Studies','Women''s PM Bible Studies',
  'Mens'' Groups','Young Adults Groups','Seniors In Action (SIA)',
  'Organic Groups'`;

const DISCIPLESHIP_MEMBERS = `
  SELECT m.person_id, gt.name AS type_name, m.role, m.joined_at
    FROM pco_group_memberships m
    JOIN pco_groups g       ON g.pco_id = m.group_id       AND g.org_id = :orgId
    JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
   WHERE m.org_id = :orgId AND m.archived_at IS NULL
     AND gt.name IN (${ADULT_DISCIPLESHIP_TYPES})`;

/** Active members of the groups under one PCO group type. */
const groupTypeMembers = (types: string) => `
  SELECT m.person_id, g.name AS group_name, m.role, m.joined_at
    FROM pco_group_memberships m
    JOIN pco_groups g       ON g.pco_id = m.group_id       AND g.org_id = :orgId
    JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND gt.name IN (${types})`;

/** Non-declined serving slots on plans of the matching service types.
 *  `person_id` is empty string for unfilled positions — always excluded. */
const servingSlots = (serviceTypeClause: string) => `
  SELECT pp.person_id, pl.sort_date, st.name AS service_type
    FROM pco_plan_people pp
    JOIN pco_plans pl        ON pl.pco_id = pp.plan_id         AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE pp.org_id = :orgId AND pp.person_id != ''
     AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
     AND (${serviceTypeClause})`;

/** Check-ins at the matching events. Deliberately never selects
 *  MAX(pco_created_at) per person — that breaks the covering index and takes
 *  the aggregate from 0.8s to 36s over 275k rows. */
const checkIns = (eventClause: string) => `
  SELECT c.person_id, c.pco_created_at, e.name AS event_name
    FROM pco_check_ins c
    JOIN pco_checkin_events e ON e.pco_id = c.event_id AND e.org_id = :orgId
   WHERE c.org_id = :orgId AND c.person_id IS NOT NULL AND (${eventClause})`;

const YEAR = `datetime('now','-365 day')`;

// ─── Block helpers ───────────────────────────────────────────────────

const stat = (
  title: string,
  sub: string,
  sql: string,
  opts: { span?: number; color?: SeedBlock["config"]["color"] } = {},
): SeedBlock => ({
  kind: "stat",
  config: { title, sub, sql, span: opts.span ?? 3, ...(opts.color ? { color: opts.color } : {}) },
});

const chart = (
  title: string,
  sub: string,
  sql: string,
  chartType = "bar",
  opts: { span?: number; colorByCategory?: boolean } = {},
): SeedBlock => ({
  kind: "chart",
  config: {
    title, sub, sql, chartType,
    span: opts.span ?? 6,
    ...(opts.colorByCategory ? { colorByCategory: true } : {}),
  },
});

const table = (title: string, sub: string, sql: string, span = 6): SeedBlock => ({
  kind: "table",
  config: { title, sub, sql, span, sortable: true },
});

/** Standard closing note for a page that HAS metrics: says plainly that the
 *  measured Outputs are a subset of the published ones. */
const measuredNote = (covered: string, uncovered: string): MirExtras["gaps"] => ({
  title: "What these numbers do and don't cover",
  intro: `Measured here: ${covered}`,
  items: [],
  footer: `_${uncovered}_`,
});

// ─── Per-ministry metrics, keyed by page slug ────────────────────────

export const MIR_EXTRAS: Record<string, MirExtras> = {
  "mir-adult-discipleship": {
    revision: 7,
    metrics: [
      stat("Engaged adults", "the denominator for every % below",
        `SELECT COUNT(*) FROM (${ENGAGED_ADULTS})`),
      stat("In a discipleship group", "engaged adults in an adult discipleship group",
        `SELECT COUNT(DISTINCT d.person_id)
           FROM (${DISCIPLESHIP_MEMBERS}) d
           JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id`, { color: "highlight" }),
      stat("% of congregation in a group", "share of engaged adults in a discipleship group",
        `SELECT ROUND(
             100.0 * (SELECT COUNT(DISTINCT d.person_id)
                        FROM (${DISCIPLESHIP_MEMBERS}) d
                        JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id)
                   / NULLIF((SELECT COUNT(*) FROM (${ENGAGED_ADULTS})), 0), 1) || '%'`),
      stat("Discipleship group leaders", "engaged adults leading a group",
        `SELECT COUNT(DISTINCT d.person_id)
           FROM (${DISCIPLESHIP_MEMBERS}) d
           JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
          WHERE d.role = 'leader'`),
      stat("Disciple-Making Groups", "people currently in a DMG",
        `SELECT COUNT(DISTINCT person_id) FROM (${DISCIPLESHIP_MEMBERS})
          WHERE type_name = 'Disciple-making Groups'`),
      stat("Adults taking Next Steps", "in a worship, community, or serving lane",
        `SELECT COUNT(*) FROM person_activity pa
           JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
          WHERE pa.org_id = :orgId AND p.is_minor = 0
            AND (pa.in_lane_wors = 1 OR pa.in_lane_comm = 1 OR pa.in_lane_serv = 1)`),
      chart("Where adults are discipled", "engaged adults by group type",
        `SELECT d.type_name AS "Group type", COUNT(DISTINCT d.person_id) AS "Adults"
           FROM (${DISCIPLESHIP_MEMBERS}) d
           JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
          GROUP BY 1 ORDER BY 2 DESC`, "bar", { colorByCategory: true }),
      chart("New discipleship-group joins by year", "people joining an adult discipleship group",
        `SELECT substr(d.joined_at,1,4) AS "Year", COUNT(DISTINCT d.person_id) AS "Joined"
           FROM (${DISCIPLESHIP_MEMBERS}) d
          WHERE d.joined_at IS NOT NULL AND substr(d.joined_at,1,4) >= '2019'
          GROUP BY 1 ORDER BY 1`, "area"),
      table("Disciple-Making Groups", "the multiplying core — each group and who leads it",
        `SELECT g.name AS "Group",
                COUNT(DISTINCT m.person_id) AS "Members",
                SUM(CASE WHEN m.role = 'leader' THEN 1 ELSE 0 END) AS "Leaders"
           FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
           LEFT JOIN pco_group_memberships m
                  ON m.group_id = g.pco_id AND m.org_id = :orgId AND m.archived_at IS NULL
          WHERE g.org_id = :orgId AND gt.name = 'Disciple-making Groups'
          GROUP BY g.name ORDER BY 2 DESC`),
      table("Discipleship reach by group type", "adults reached, and how many of them lead",
        `SELECT d.type_name AS "Group type",
                COUNT(DISTINCT d.person_id) AS "Adults",
                COUNT(DISTINCT CASE WHEN d.role = 'leader' THEN d.person_id END) AS "Leaders"
           FROM (${DISCIPLESHIP_MEMBERS}) d
           JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: {
      intro:
        "These Outputs are in the published report but have no data behind them today. Listed here rather than dropped, so the gap is visible and fixable:",
      items: [
        "- **# of people who come to faith in Christ** — no faith-decision is recorded anywhere we sync. Needs a PCO form or workflow that stamps the person's record.",
        "- **# of baptisms** — baptism *services* are on the calendar (a BAPTISMS service type, roughly twice a year, most recently 13 Sep 2026), but the only people recorded against them are the volunteers serving. Nobody records who was baptised. The `Going Public (Baptism)` check-in event exists and has never had a single check-in — using it would make this live immediately.",
        "- **% who attend Discover Courses** — the course is still running (Discover Faith Church is scheduled through **September 2026**); what stopped in **February 2020** is checking attendees in. We can see the sessions happened and who staffed them, not who came.",
        "- **% who attend Discipleship Workshops** — no check-in event or group type corresponds to the workshops.",
        "- **% who complete a Disciple-Making Group** — we can see current membership, not completion. Needs an archived-with-outcome convention, or a \"graduated\" list.",
        "- **% of DMG graduates who become leaders** — depends on completion above.",
        "- **Standardized spiritual growth inventory** — no instrument has been administered, so there is nothing to report.",
      ],
      footer:
        "_The Outputs that ARE live above come from PCO group membership and the app's own lane classification._",
    },
  },

  "mir-small-groups": {
    metrics: [
      stat("People in a small group", "active memberships, all ages",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'Small Groups'")})`,
        { color: "highlight" }),
      stat("Active small groups", "groups of the Small Groups type",
        `SELECT COUNT(DISTINCT g.pco_id)
           FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE g.org_id = :orgId AND gt.name = 'Small Groups'`),
      stat("Small group leaders", "members with the leader role",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'Small Groups'")})
          WHERE role = 'leader'`),
      stat("% of engaged adults", "adults in a small group",
        `SELECT ROUND(
             100.0 * (SELECT COUNT(DISTINCT m.person_id)
                        FROM (${groupTypeMembers("'Small Groups'")}) m
                        JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = m.person_id)
                   / NULLIF((SELECT COUNT(*) FROM (${ENGAGED_ADULTS})), 0), 1) || '%'`),
      chart("Group sizes", "members per small group",
        `SELECT group_name AS "Group", COUNT(DISTINCT person_id) AS "Members"
           FROM (${groupTypeMembers("'Small Groups'")})
          GROUP BY 1 ORDER BY 2 DESC LIMIT 25`),
      chart("New small-group joins by year", "people joining a small group",
        `SELECT substr(joined_at,1,4) AS "Year", COUNT(DISTINCT person_id) AS "Joined"
           FROM (${groupTypeMembers("'Small Groups'")})
          WHERE joined_at IS NOT NULL AND substr(joined_at,1,4) >= '2019'
          GROUP BY 1 ORDER BY 1`, "area"),
    ],
    gaps: measuredNote(
      "group count, membership, leaders, and the share of engaged adults in a small group — all from live PCO group membership.",
      "Not measured: anything about what happens inside a group. Attendance, multiplication, curriculum progress and leader-development milestones are not recorded in PCO, so the published Outputs that depend on them stay unmeasured.",
    ),
  },

  "mir-kids-general": {
    metrics: [
      stat("Kids checked in", "distinct children, last 12 months",
        `SELECT COUNT(DISTINCT person_id) FROM (${checkIns("lower(e.name) LIKE '%kids%'")})
          WHERE pco_created_at >= ${YEAR}`, { color: "highlight" }),
      stat("Check-ins", "kids check-ins, last 12 months",
        `SELECT COUNT(*) FROM (${checkIns("lower(e.name) LIKE '%kids%'")})
          WHERE pco_created_at >= ${YEAR}`),
      stat("Average kids per Sunday", "from the weekly attendance record",
        `SELECT CAST(ROUND(AVG(kids_total)) AS INT) FROM attendance_weekly
          WHERE org_id = :orgId AND kids_total IS NOT NULL
            AND week_date >= date('now','-365 day')`),
      stat("Kids ministry volunteers", "active members of a Faith Kids team",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND (t.name LIKE 'FK %' OR lower(t.name) LIKE '%kids%')`),
      chart("Kids attendance by week", "children counted in the weekly attendance record",
        `SELECT week_date AS "Week", kids_total AS "Kids"
           FROM attendance_weekly
          WHERE org_id = :orgId AND kids_total IS NOT NULL
            AND week_date >= date('now','-730 day')
          ORDER BY week_date`, "line"),
      table("Where kids check in", "check-ins by event, last 12 months",
        `SELECT event_name AS "Event",
                COUNT(DISTINCT person_id) AS "Children",
                COUNT(*) AS "Check-ins"
           FROM (${checkIns("lower(e.name) LIKE '%kids%'")})
          WHERE pco_created_at >= ${YEAR}
          GROUP BY 1 ORDER BY 3 DESC`),
    ],
    gaps: measuredNote(
      "check-in volume and distinct children reached, plus the weekly attendance record and the volunteer roster.",
      "Not measured: safety and ratio compliance, curriculum completion, parent feedback, or anything about a child's spiritual growth — none of it is recorded in a system we sync.",
    ),
  },

  "mir-kids-vbx": {
    metrics: [
      stat("Children reached at VBX", "distinct children, all VBX years",
        `SELECT COUNT(DISTINCT person_id) FROM (${checkIns("e.name LIKE 'VBX%'")})`,
        { color: "highlight" }),
      stat("VBX check-ins", "every check-in across all VBX years",
        `SELECT COUNT(*) FROM (${checkIns("e.name LIKE 'VBX%'")})`),
      stat("VBX years tracked", "years with check-in data",
        `SELECT COUNT(DISTINCT substr(event_name, 5, 4)) FROM (${checkIns("e.name LIKE 'VBX%'")})`),
      chart("VBX attendance by year", "distinct children checked in",
        `SELECT event_name AS "VBX", COUNT(DISTINCT person_id) AS "Children"
           FROM (${checkIns("e.name LIKE 'VBX%'")})
          GROUP BY 1 ORDER BY 1`, "bar", { colorByCategory: true }),
      table("VBX by year", "children and total check-ins per year",
        `SELECT event_name AS "VBX",
                COUNT(DISTINCT person_id) AS "Children",
                COUNT(*) AS "Check-ins"
           FROM (${checkIns("e.name LIKE 'VBX%'")})
          GROUP BY 1 ORDER BY 1 DESC`),
    ],
    gaps: measuredNote(
      "children reached and check-in volume per VBX year, from PCO check-ins.",
      "Not measured: volunteer hours, salvation decisions, first-time-guest conversion into ongoing attendance, or budget per child.",
    ),
  },

  "mir-students-high-school": {
    metrics: [
      stat("High-school students", "distinct students checked in, last 12 months",
        `SELECT COUNT(DISTINCT person_id)
           FROM (${checkIns("e.name IN ('Sunday AM Students','Sunday Afternoon Students')")})
          WHERE pco_created_at >= ${YEAR}`, { color: "highlight" }),
      stat("Check-ins", "last 12 months",
        `SELECT COUNT(*)
           FROM (${checkIns("e.name IN ('Sunday AM Students','Sunday Afternoon Students')")})
          WHERE pco_created_at >= ${YEAR}`),
      stat("Students serving", "scheduled on an FC Students - HS plan, last 12 months",
        `SELECT COUNT(DISTINCT person_id)
           FROM (${servingSlots("st.name = 'FC Students- HS'")})
          WHERE sort_date >= ${YEAR}`),
      stat("Average students per week", "from the weekly attendance record",
        `SELECT CAST(ROUND(AVG(student_total)) AS INT) FROM attendance_weekly
          WHERE org_id = :orgId AND student_total IS NOT NULL
            AND week_date >= date('now','-365 day')`),
      chart("Student attendance by week", "students counted in the weekly attendance record",
        `SELECT week_date AS "Week", student_total AS "Students"
           FROM attendance_weekly
          WHERE org_id = :orgId AND student_total IS NOT NULL
            AND week_date >= date('now','-730 day')
          ORDER BY week_date`, "line"),
      table("Where high-school students check in", "last 12 months",
        `SELECT event_name AS "Event",
                COUNT(DISTINCT person_id) AS "Students",
                COUNT(*) AS "Check-ins"
           FROM (${checkIns("e.name IN ('Sunday AM Students','Sunday Afternoon Students')")})
          WHERE pco_created_at >= ${YEAR}
          GROUP BY 1 ORDER BY 3 DESC`),
    ],
    gaps: measuredNote(
      "students reached, check-in volume, and students scheduled to serve.",
      "The weekly attendance record does not split high school from middle school, so the per-week average covers all students. Small-group participation, discipleship progress and parent engagement are not recorded.",
    ),
  },

  "mir-students-middle-school": {
    metrics: [
      stat("Middle-school students", "distinct students checked in, last 12 months",
        `SELECT COUNT(DISTINCT person_id)
           FROM (${checkIns("e.name IN ('Wednesday PM Students','Sunday PM Students')")})
          WHERE pco_created_at >= ${YEAR}`, { color: "highlight" }),
      stat("Check-ins", "last 12 months",
        `SELECT COUNT(*)
           FROM (${checkIns("e.name IN ('Wednesday PM Students','Sunday PM Students')")})
          WHERE pco_created_at >= ${YEAR}`),
      stat("Wednesday reach", "distinct students on Wednesday nights, last 12 months",
        `SELECT COUNT(DISTINCT person_id)
           FROM (${checkIns("e.name = 'Wednesday PM Students'")})
          WHERE pco_created_at >= ${YEAR}`),
      stat("Average students per week", "all students, from the weekly attendance record",
        `SELECT CAST(ROUND(AVG(student_total)) AS INT) FROM attendance_weekly
          WHERE org_id = :orgId AND student_total IS NOT NULL
            AND week_date >= date('now','-365 day')`),
      chart("Middle-school check-ins by month", "last two years",
        `SELECT substr(pco_created_at,1,7) AS "Month", COUNT(*) AS "Check-ins"
           FROM (${checkIns("e.name IN ('Wednesday PM Students','Sunday PM Students')")})
          WHERE pco_created_at >= datetime('now','-730 day')
          GROUP BY 1 ORDER BY 1`, "area"),
      table("Where middle-school students check in", "last 12 months",
        `SELECT event_name AS "Event",
                COUNT(DISTINCT person_id) AS "Students",
                COUNT(*) AS "Check-ins"
           FROM (${checkIns("e.name IN ('Wednesday PM Students','Sunday PM Students')")})
          WHERE pco_created_at >= ${YEAR}
          GROUP BY 1 ORDER BY 3 DESC`),
    ],
    gaps: measuredNote(
      "students reached and check-in volume on the Wednesday and Sunday evening programmes.",
      "The weekly attendance record does not split middle school from high school. Small-group participation, leader ratios and discipleship progress are not recorded.",
    ),
  },

  "mir-guest-experience": {
    metrics: [
      stat("Guest Experience volunteers", "people scheduled on a GE team, last 12 months",
        `SELECT COUNT(DISTINCT person_id)
           FROM (${servingSlots("st.name LIKE 'Guest Experience%'")})
          WHERE sort_date >= ${YEAR}`, { color: "highlight" }),
      stat("Serving slots filled", "GE assignments, last 12 months",
        `SELECT COUNT(*) FROM (${servingSlots("st.name LIKE 'Guest Experience%'")})
          WHERE sort_date >= ${YEAR}`),
      stat("On a Guest Experience team", "active team membership",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND (t.name LIKE 'Guest Experience%' OR t.name = 'First Impressions'
                 OR t.name = 'Coffee Bar Team')`),
      stat("First-time visitors on record", "people PCO still classes as 1st Time Visitor",
        `SELECT COUNT(*) FROM pco_people
          WHERE org_id = :orgId AND membership_type = '1st Time Visitor'`),
      chart("Guest Experience serving by month", "assignments filled",
        `SELECT substr(sort_date,1,7) AS "Month", COUNT(*) AS "Slots"
           FROM (${servingSlots("st.name LIKE 'Guest Experience%'")})
          WHERE sort_date >= datetime('now','-730 day') AND sort_date <= datetime('now')
          GROUP BY 1 ORDER BY 1`, "area"),
      table("Guest Experience teams", "volunteers and slots by service type, last 12 months",
        `SELECT service_type AS "Service type",
                COUNT(DISTINCT person_id) AS "Volunteers",
                COUNT(*) AS "Slots"
           FROM (${servingSlots("st.name LIKE 'Guest Experience%'")})
          WHERE sort_date >= ${YEAR}
          GROUP BY 1 ORDER BY 3 DESC`),
    ],
    gaps: measuredNote(
      "the volunteer side of guest experience — who serves, how often, and on which teams — plus the standing count of first-time visitor records.",
      "Not measured: what guests actually experienced. There is no guest survey, no follow-up completion rate, and no record of whether a first-time visitor returned. The membership-fit audit shows most 1st Time Visitor records are stale, so treat that figure as a data-hygiene number, not a footfall number.",
    ),
  },

  "mir-prayer-works": {
    metrics: [
      stat("Prayer volunteers", "active members of a prayer team",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND lower(t.name) LIKE '%prayer%'`, { color: "highlight" }),
      stat("Prayer requests received", "Network Prayer Request form submissions, all time",
        `SELECT COUNT(*) FROM pco_form_submissions s
           JOIN pco_forms f ON f.pco_id = s.form_id AND f.org_id = :orgId
          WHERE s.org_id = :orgId AND f.name = 'Network Prayer Request'`),
      stat("Prayer serving slots", "PRAYER WORKS assignments, last 12 months",
        `SELECT COUNT(*) FROM (${servingSlots("st.name LIKE 'PRAYER%'")})
          WHERE sort_date >= ${YEAR}`),
      stat("People serving in prayer", "distinct volunteers scheduled, last 12 months",
        `SELECT COUNT(DISTINCT person_id) FROM (${servingSlots("st.name LIKE 'PRAYER%'")})
          WHERE sort_date >= ${YEAR}`),
      chart("Prayer requests by month", "Network Prayer Request submissions",
        `SELECT substr(s.pco_created_at,1,7) AS "Month", COUNT(*) AS "Requests"
           FROM pco_form_submissions s
           JOIN pco_forms f ON f.pco_id = s.form_id AND f.org_id = :orgId
          WHERE s.org_id = :orgId AND f.name = 'Network Prayer Request'
            AND s.pco_created_at >= datetime('now','-730 day')
          GROUP BY 1 ORDER BY 1`, "area"),
      table("Prayer teams", "active membership",
        `SELECT t.name AS "Team", COUNT(DISTINCT m.person_id) AS "Members"
           FROM pco_teams t
           JOIN pco_team_memberships m
             ON m.team_id = t.pco_id AND m.org_id = :orgId
            AND m.archived_at IS NULL AND m.person_id != ''
          WHERE t.org_id = :orgId AND lower(t.name) LIKE '%prayer%'
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: measuredNote(
      "prayer requests received through the Network Prayer Request form, the prayer volunteer roster, and Sunday prayer serving.",
      "Not measured: what happened to a request after it was received — whether it was prayed over, answered, or followed up. Requests submitted any other way (in person, by phone, on a card) never reach a system we sync.",
    ),
  },

  "mir-sunday-teaching": {
    metrics: [
      stat("Sermons on record", "every sermon we have captured",
        `SELECT COUNT(*) FROM sermons WHERE org_id = :orgId`, { color: "highlight" }),
      stat("Sermons in the last year", "preached in the last 12 months",
        `SELECT COUNT(*) FROM sermons
          WHERE org_id = :orgId AND preached_on >= date('now','-365 day')`),
      stat("Speakers", "distinct people who have preached",
        `SELECT COUNT(DISTINCT speaker) FROM sermons
          WHERE org_id = :orgId AND speaker IS NOT NULL AND trim(speaker) != ''`),
      stat("Average adult attendance", "adults per week, last 12 months",
        `SELECT CAST(ROUND(AVG(adult_total)) AS INT) FROM attendance_weekly
          WHERE org_id = :orgId AND adult_total IS NOT NULL
            AND week_date >= date('now','-365 day')`),
      chart("Sermons by year", "how much teaching we have captured",
        `SELECT substr(preached_on,1,4) AS "Year", COUNT(*) AS "Sermons"
           FROM sermons WHERE org_id = :orgId AND preached_on IS NOT NULL
          GROUP BY 1 ORDER BY 1`, "bar"),
      table("Who preaches", "sermons by speaker",
        `SELECT speaker AS "Speaker", COUNT(*) AS "Sermons",
                MAX(substr(preached_on,1,10)) AS "Most recent"
           FROM sermons
          WHERE org_id = :orgId AND speaker IS NOT NULL AND trim(speaker) != ''
          GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    ],
    gaps: measuredNote(
      "teaching volume, who preaches, and the adult attendance it reaches.",
      "Not measured: whether the teaching landed. Comprehension, application, and the next steps people took because of a sermon are not recorded — the Sermon Lab work on next-step calls is the closest thing and is not wired into this page.",
    ),
  },

  "mir-online-ministry": {
    metrics: [
      stat("Average live viewers", "per week, last 12 months",
        `SELECT CAST(ROUND(AVG(online_live)) AS INT) FROM attendance_weekly
          WHERE org_id = :orgId AND online_live IS NOT NULL
            AND week_date >= date('now','-365 day')`, { color: "highlight" }),
      stat("Average on-demand", "per week, last 12 months",
        `SELECT CAST(ROUND(AVG(online_on_demand)) AS INT) FROM attendance_weekly
          WHERE org_id = :orgId AND online_on_demand IS NOT NULL
            AND week_date >= date('now','-365 day')`),
      stat("Online share of reach", "online as a share of online + in person",
        `SELECT ROUND(100.0 * SUM(COALESCE(online_live,0) + COALESCE(online_on_demand,0))
                    / NULLIF(SUM(COALESCE(online_live,0) + COALESCE(online_on_demand,0)
                                 + COALESCE(in_person_total,0)), 0), 1) || '%'
           FROM attendance_weekly
          WHERE org_id = :orgId AND week_date >= date('now','-365 day')`),
      stat("Weeks on record", "weeks with an attendance figure",
        `SELECT COUNT(*) FROM attendance_weekly WHERE org_id = :orgId`),
      chart("Online vs in person", "weekly reach over the last two years",
        `SELECT week_date AS "Week",
                in_person_total AS "In person",
                online_live AS "Online live",
                online_on_demand AS "On demand"
           FROM attendance_weekly
          WHERE org_id = :orgId AND week_date >= date('now','-730 day')
          ORDER BY week_date`, "line"),
      table("Most recent weeks", "as recorded in the weekly attendance sheet",
        `SELECT week_date AS "Week", in_person_total AS "In person",
                online_live AS "Live", online_on_demand AS "On demand"
           FROM attendance_weekly
          WHERE org_id = :orgId ORDER BY week_date DESC LIMIT 12`),
    ],
    gaps: measuredNote(
      "live and on-demand viewership from the weekly attendance sheet, and online's share of total reach.",
      "These figures come from a manually maintained attendance sheet, not a live feed — check the most recent week above before quoting them. Not measured: who watched (the numbers are anonymous counts), watch duration, chat engagement, or online-to-in-person conversion.",
    ),
  },

  "mir-communications-engagement": {
    metrics: [
      stat("Campaigns sent", "last 12 months",
        `SELECT COUNT(*) FROM cc_campaigns
          WHERE org_id = :orgId AND last_sent_date >= ${YEAR}`, { color: "highlight" }),
      stat("Emails delivered", "total sends, last 12 months",
        `SELECT SUM(stat_sends) FROM cc_campaigns
          WHERE org_id = :orgId AND last_sent_date >= ${YEAR}`),
      stat("Open rate", "opens ÷ sends, last 12 months",
        `SELECT ROUND(100.0 * SUM(stat_opens) / NULLIF(SUM(stat_sends),0), 1) || '%'
           FROM cc_campaigns WHERE org_id = :orgId AND last_sent_date >= ${YEAR}`),
      stat("Click rate", "clicks ÷ sends, last 12 months",
        `SELECT ROUND(100.0 * SUM(stat_clicks) / NULLIF(SUM(stat_sends),0), 2) || '%'
           FROM cc_campaigns WHERE org_id = :orgId AND last_sent_date >= ${YEAR}`),
      chart("Email reach by month", "sends and opens",
        `SELECT substr(last_sent_date,1,7) AS "Month",
                SUM(stat_sends) AS "Sends", SUM(stat_opens) AS "Opens"
           FROM cc_campaigns
          WHERE org_id = :orgId AND last_sent_date >= datetime('now','-730 day')
          GROUP BY 1 ORDER BY 1`, "line"),
      table("Recent campaigns", "the last 15 sent, with their engagement",
        `SELECT name AS "Campaign", substr(last_sent_date,1,10) AS "Sent",
                stat_sends AS "Sends", stat_opens AS "Opens", stat_clicks AS "Clicks"
           FROM cc_campaigns
          WHERE org_id = :orgId AND last_sent_date IS NOT NULL
          ORDER BY last_sent_date DESC LIMIT 15`),
    ],
    gaps: measuredNote(
      "email reach and engagement from Constant Contact — sends, opens, clicks and unsubscribes.",
      "Email is only one channel. Social reach, app engagement, website traffic and print are not synced, so the published Outputs covering those stay unmeasured.",
    ),
  },
};
