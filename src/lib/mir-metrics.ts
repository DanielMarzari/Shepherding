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
// Ministries deliberately left unmeasured, because nothing we sync speaks to
// them: Anathallo (its records live in an external EHR), both Contracts pages,
// Human Resources, Reception, Information Technology, Technology - General,
// Christmas Tree Lighting, Global Outreach, Spanish Language Opportunities,
// Unreached Language Group, Communications - Content Creation, Worship -
// Original Music, Kids - Specialized Needs, and Care Groups — whose
// "Care Ministries" group type exists in PCO with no members at all.

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

/** Faith Church Music's own catalogue — the songs the church wrote and released
 *  (Spotify artist 0uGQrDiryyi7PtrYRgoRz9, "Faith Church Music"): the Room Of
 *  Resurrections album and the This Is Christmas EP.
 *
 *  These are the PCO plan-item spellings, lower-cased and trimmed, matched
 *  EXACTLY rather than with LIKE — a substring match on "promise" pulls in
 *  "Standing On The Promises" and "God Of The Promise", which are not ours.
 *  The page lists every matched title in a table, so a missing or wrongly
 *  matched song is visible rather than silently wrong. Add new releases here.
 *  A "(REPRISE)" is folded back into its parent with a CASE rather than
 *  replace() — the builder's read-only engine rejects replace() as a write
 *  keyword, and a query it rejects renders as an error card, not a number. */
const ORIGINAL_SONG_TITLES = `
  'room of resurrections','the kingdom of god','the promises you''ve sown',
  'my helper','this is christmas','this is christmas (reprise)'`;

/** One row per appearance of an original song on a service plan.
 *
 *  IMPORTANT: LIVE and CLASSIC run at the same hour in different rooms with
 *  different bands, so a song sung in both is ONE song sung on ONE Sunday, not
 *  two. Every count below is therefore over DISTINCT (song, date) pairs, never
 *  over rows. Rows are still what this returns, because the venue split is
 *  worth showing — it just must not be summed.
 *
 *  `song` folds a "(REPRISE)" back into its parent: a reprise is the same song
 *  again in the same service, not another song. */
const ORIGINAL_SONG_USES = `
  SELECT CASE WHEN lower(trim(i.title)) = 'this is christmas (reprise)'
              THEN 'this is christmas'
              ELSE lower(trim(i.title)) END AS song,
         trim(i.title)                AS printed_title,
         substr(pl.sort_date, 1, 10)  AS used_on,
         st.name                      AS service_type
    FROM pco_plan_items i
    JOIN pco_plans pl         ON pl.pco_id = i.plan_id          AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE i.org_id = :orgId AND i.item_type = 'song'
     AND lower(trim(i.title)) IN (${ORIGINAL_SONG_TITLES})`;

const YEAR = `datetime('now','-365 day')`;

// ─── Block helpers ───────────────────────────────────────────────────

const stat = (
  title: string,
  sub: string,
  sql: string,
  opts: {
    span?: number;
    color?: SeedBlock["config"]["color"];
    /** Title of another block on the page to reveal on "See more". The detail
     *  gets its own card, so it takes a normal slot in the grid. */
    revealsBlockTitle?: string;
    detailLabel?: string;
  } = {},
): SeedBlock => ({
  kind: "stat",
  config: {
    title, sub, sql,
    span: opts.span ?? 3,
    ...(opts.color ? { color: opts.color } : {}),
    ...(opts.revealsBlockTitle ? { revealsBlockTitle: opts.revealsBlockTitle } : {}),
    ...(opts.detailLabel ? { detailLabel: opts.detailLabel } : {}),
  },
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

  "mir-finance": {
    metrics: [
      stat("Donors on record", "PushPay donors matched to a person",
        `SELECT COUNT(DISTINCT person_id) FROM pushpay_donors
          WHERE org_id = :orgId AND person_id IS NOT NULL`, { color: "highlight" }),
      stat("Gave in the last year", "donors with a gift in the last 12 months",
        `SELECT COUNT(*) FROM pushpay_donors
          WHERE org_id = :orgId AND last_gift_date >= date('now','-365 day')`),
      stat("Recurring donors", "donors PushPay classes as recurring",
        `SELECT COUNT(*) FROM pushpay_donors
          WHERE org_id = :orgId AND donor_stage = 'Recurring Donor'`),
      stat("Giving households reached", "distinct households with a matched donor",
        `SELECT COUNT(DISTINCT hm.household_id)
           FROM pushpay_donors d
           JOIN pco_household_memberships hm
             ON hm.person_id = d.person_id AND hm.org_id = :orgId
          WHERE d.org_id = :orgId AND d.person_id IS NOT NULL`),
      chart("Donors by stage", "how PushPay classifies each donor",
        `SELECT COALESCE(donor_stage,'(unclassified)') AS "Stage", COUNT(*) AS "Donors"
           FROM pushpay_donors WHERE org_id = :orgId
          GROUP BY 1 ORDER BY 2 DESC`, "bar", { colorByCategory: true }),
      chart("How people give", "offline vs digital",
        `SELECT COALESCE(giving_channel,'(unknown)') AS "Channel", COUNT(*) AS "Donors"
           FROM pushpay_donors WHERE org_id = :orgId
          GROUP BY 1 ORDER BY 2 DESC`, "donut"),
    ],
    gaps: measuredNote(
      "donor counts, recency and stage from the PushPay export, plus how people give.",
      "Amounts are deliberately absent: the import carries donor stage and last-gift date, not gift values, so nothing here is a financial total. Budget performance, expense ratios and designated-fund balances live in the accounting system, which is not synced.",
    ),
  },

  "mir-next-steps": {
    metrics: [
      stat("Adults taking a next step", "in at least one lane",
        `SELECT COUNT(*) FROM person_activity pa
           JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
          WHERE pa.org_id = :orgId AND p.is_minor = 0
            AND (pa.in_lane_wors = 1 OR pa.in_lane_comm = 1 OR pa.in_lane_serv = 1)`,
        { color: "highlight" }),
      stat("In the worship lane", "attending or scheduled recently",
        `SELECT COUNT(*) FROM person_activity pa
           JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
          WHERE pa.org_id = :orgId AND p.is_minor = 0 AND pa.in_lane_wors = 1`),
      stat("In the community lane", "in at least one active group",
        `SELECT COUNT(*) FROM person_activity pa
           JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
          WHERE pa.org_id = :orgId AND p.is_minor = 0 AND pa.in_lane_comm = 1`),
      stat("In the serving lane", "on at least one active team",
        `SELECT COUNT(*) FROM person_activity pa
           JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
          WHERE pa.org_id = :orgId AND p.is_minor = 0 AND pa.in_lane_serv = 1`),
      chart("How engaged adults are classified", "the app's own activity classification",
        `SELECT pa.classification AS "Classification", COUNT(*) AS "Adults"
           FROM person_activity pa
           JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
          WHERE pa.org_id = :orgId AND p.is_minor = 0 AND pa.classification IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC`, "bar", { colorByCategory: true }),
      table("Lane combinations", "how many lanes an adult is in",
        `SELECT (pa.in_lane_wors + pa.in_lane_comm + pa.in_lane_serv) AS "Lanes",
                COUNT(*) AS "Adults"
           FROM person_activity pa
           JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
          WHERE pa.org_id = :orgId AND p.is_minor = 0
          GROUP BY 1 ORDER BY 1 DESC`),
    ],
    gaps: measuredNote(
      "lane membership from the app's own activity rollup — worship, community and serving.",
      "A lane says someone is currently doing something, not that they took a deliberate next step. Whether a person was invited, said yes, and followed through is not recorded anywhere we sync.",
    ),
  },

  "mir-foster-and-adoption": {
    metrics: [
      stat("People connected", "active members of a Foster & Adoption group",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'Foster Adopt Volunteers','Foster Adopt Organizations','Foster Adopt Care Communities'")})`,
        { color: "highlight" }),
      stat("Volunteers", "in the Foster Adopt Volunteers groups",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'Foster Adopt Volunteers'")})`),
      stat("Care communities", "wrap-around groups around a family",
        `SELECT COUNT(DISTINCT g.pco_id) FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE g.org_id = :orgId AND gt.name = 'Foster Adopt Care Communities'`),
      stat("Partner organisations", "agencies and partners tracked as groups",
        `SELECT COUNT(DISTINCT g.pco_id) FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE g.org_id = :orgId AND gt.name = 'Foster Adopt Organizations'`),
      chart("Where people are connected", "by group type",
        `SELECT gt.name AS "Group type", COUNT(DISTINCT m.person_id) AS "People"
           FROM pco_group_memberships m
           JOIN pco_groups g       ON g.pco_id = m.group_id       AND g.org_id = :orgId
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND gt.name LIKE 'Foster%'
          GROUP BY 1 ORDER BY 2 DESC`, "bar", { colorByCategory: true }),
    ],
    gaps: measuredNote(
      "who is connected to the ministry through PCO groups — volunteers, care communities and partner organisations.",
      "Not measured: placements supported, children served, or family outcomes. Those live with the agencies, not in PCO.",
    ),
  },

  "mir-english-as-a-second-language": {
    metrics: [
      // 10 of the 14 carry the leader role, so this is everyone attached to an
      // ESL group — teachers included — not a student count.
      stat("People connected", "everyone in an ESL group, teachers included",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'ESL (non-PTS)'")})`,
        { color: "highlight" }),
      stat("ESL groups", "classes tracked as PCO groups",
        `SELECT COUNT(DISTINCT g.pco_id) FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE g.org_id = :orgId AND gt.name = 'ESL (non-PTS)'`),
      stat("Group leaders", "members with the leader role",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'ESL (non-PTS)'")})
          WHERE role = 'leader'`),
      table("ESL groups", "membership by class",
        `SELECT group_name AS "Group", COUNT(DISTINCT person_id) AS "People"
           FROM (${groupTypeMembers("'ESL (non-PTS)'")})
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: measuredNote(
      "everyone attached to an ESL group in PCO, and how many carry the leader role.",
      "Most of this roster is leaders — only 4 of the 14 are not — so it does not tell you how many students the ministry reaches. ESL attendance is not checked in, and students are largely not entered into PCO at all, so class size, sessions run and English progress are all unmeasured.",
    ),
  },

  "mir-shepherd-team": {
    metrics: [
      stat("Shepherd team", "people on the Shepherd Team reference list",
        `SELECT COUNT(*) FROM pco_list_memberships m
           JOIN pco_lists l ON l.pco_id = m.list_id AND l.org_id = :orgId
          WHERE m.org_id = :orgId AND l.name = 'REFERENCE - Shepherd Team'`,
        { color: "highlight" }),
      stat("Shepherds with an assignment", "shepherds who have something assigned",
        `SELECT COUNT(DISTINCT shepherd_person_id) FROM shepherd_assignments
          WHERE org_id = :orgId`),
      stat("Assignments", "shepherding assignments on record",
        `SELECT COUNT(*) FROM shepherd_assignments WHERE org_id = :orgId`),
      stat("Engaged adults", "the flock the team is shepherding",
        `SELECT COUNT(*) FROM (${ENGAGED_ADULTS})`),
      table("Assignments by kind", "what shepherds are assigned to",
        `SELECT target_kind AS "Assigned to", COUNT(*) AS "Assignments",
                COUNT(DISTINCT shepherd_person_id) AS "Shepherds"
           FROM shepherd_assignments WHERE org_id = :orgId
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: measuredNote(
      "the size of the shepherd team and how many assignments exist.",
      "Not measured: whether shepherding actually happened. Contacts made, visits, and care conversations are not recorded — the care queue and care map are the places that work would show up, and neither feeds this page.",
    ),
  },

  "mir-elders": {
    metrics: [
      stat("Elders", "on the Elders reference list",
        `SELECT COUNT(*) FROM pco_list_memberships m
           JOIN pco_lists l ON l.pco_id = m.list_id AND l.org_id = :orgId
          WHERE m.org_id = :orgId AND l.name = 'REFERENCE - Elders'`, { color: "highlight" }),
      stat("Elders also shepherding", "elders with a shepherding assignment",
        `SELECT COUNT(DISTINCT s.shepherd_person_id)
           FROM shepherd_assignments s
           JOIN pco_list_memberships m ON m.person_id = s.shepherd_person_id AND m.org_id = :orgId
           JOIN pco_lists l ON l.pco_id = m.list_id AND l.org_id = :orgId
          WHERE s.org_id = :orgId AND l.name = 'REFERENCE - Elders'`),
      stat("Engaged adults per elder", "the flock each elder carries",
        `SELECT CAST(ROUND(
             (SELECT COUNT(*) FROM (${ENGAGED_ADULTS})) * 1.0
             / NULLIF((SELECT COUNT(*) FROM pco_list_memberships m
                         JOIN pco_lists l ON l.pco_id = m.list_id AND l.org_id = :orgId
                        WHERE m.org_id = :orgId AND l.name = 'REFERENCE - Elders'), 0)) AS INT)`),
    ],
    gaps: measuredNote(
      "the size of the eldership and the ratio of engaged adults to elders.",
      "This is a roster count only. Elder meetings, decisions, doctrinal oversight and member care are not recorded in any system we sync.",
    ),
  },

  "mir-deacons": {
    metrics: [
      stat("Deacons", "on the Deacons reference list",
        `SELECT COUNT(*) FROM pco_list_memberships m
           JOIN pco_lists l ON l.pco_id = m.list_id AND l.org_id = :orgId
          WHERE m.org_id = :orgId AND l.name = 'REFERENCE - Deacons'`, { color: "highlight" }),
      stat("Deacons serving on a team", "also on an active serving team",
        `SELECT COUNT(DISTINCT tm.person_id)
           FROM pco_team_memberships tm
           JOIN pco_list_memberships m ON m.person_id = tm.person_id AND m.org_id = :orgId
           JOIN pco_lists l ON l.pco_id = m.list_id AND l.org_id = :orgId
          WHERE tm.org_id = :orgId AND tm.archived_at IS NULL AND tm.person_id != ''
            AND l.name = 'REFERENCE - Deacons'`),
      stat("Benevolence-only records", "people PCO classes as Benevolence Only",
        `SELECT COUNT(*) FROM pco_people
          WHERE org_id = :orgId AND membership_type = 'Benevolence Only'`),
    ],
    gaps: measuredNote(
      "the size of the diaconate and the standing count of benevolence-only records.",
      "Not measured: benevolence requests received, assistance given, or need met. None of that is recorded in PCO, so the published Outputs about care delivered stay unmeasured.",
    ),
  },

  "mir-worship-live": {
    metrics: [
      stat("Volunteers scheduled", "distinct people on a LIVE plan, last 12 months",
        `SELECT COUNT(DISTINCT person_id) FROM (${servingSlots("st.name LIKE 'LIVE%'")})
          WHERE sort_date >= ${YEAR}`, { color: "highlight" }),
      stat("Serving slots filled", "LIVE assignments, last 12 months",
        `SELECT COUNT(*) FROM (${servingSlots("st.name LIKE 'LIVE%'")})
          WHERE sort_date >= ${YEAR}`),
      stat("Services planned", "LIVE plans, last 12 months",
        `SELECT COUNT(DISTINCT pl.pco_id) FROM pco_plans pl
           JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
          WHERE pl.org_id = :orgId AND st.name LIKE 'LIVE%'
            AND pl.sort_date >= ${YEAR} AND pl.sort_date <= datetime('now')`),
      stat("Average attendance in the Center", "per service, last 12 months",
        `SELECT CAST(ROUND(AVG(count)) AS INT) FROM attendance_service
          WHERE org_id = :orgId AND room = 'center'
            AND week_date >= date('now','-365 day')`),
      chart("Center attendance by service", "average headcount per service time",
        `SELECT service AS "Service", CAST(ROUND(AVG(count)) AS INT) AS "Average"
           FROM attendance_service
          WHERE org_id = :orgId AND room = 'center'
            AND week_date >= date('now','-365 day')
          GROUP BY 1 ORDER BY 1`, "bar", { colorByCategory: true }),
      chart("LIVE serving by month", "assignments filled",
        `SELECT substr(sort_date,1,7) AS "Month", COUNT(*) AS "Slots"
           FROM (${servingSlots("st.name LIKE 'LIVE%'")})
          WHERE sort_date >= datetime('now','-730 day') AND sort_date <= datetime('now')
          GROUP BY 1 ORDER BY 1`, "area"),
    ],
    gaps: measuredNote(
      "the serving roster behind the LIVE services and the attendance they drew.",
      "Attendance comes from a manually maintained sheet, so check its most recent week before quoting it. Not measured: anything about the worship itself — song selection, engagement, or how people responded.",
    ),
  },

  "mir-worship-classic": {
    metrics: [
      stat("Volunteers scheduled", "distinct people on a CLASSIC plan, last 12 months",
        `SELECT COUNT(DISTINCT person_id) FROM (${servingSlots("st.name LIKE 'CLASSIC%'")})
          WHERE sort_date >= ${YEAR}`, { color: "highlight" }),
      stat("Serving slots filled", "CLASSIC assignments, last 12 months",
        `SELECT COUNT(*) FROM (${servingSlots("st.name LIKE 'CLASSIC%'")})
          WHERE sort_date >= ${YEAR}`),
      stat("Services planned", "CLASSIC plans, last 12 months",
        `SELECT COUNT(DISTINCT pl.pco_id) FROM pco_plans pl
           JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
          WHERE pl.org_id = :orgId AND st.name LIKE 'CLASSIC%'
            AND pl.sort_date >= ${YEAR} AND pl.sort_date <= datetime('now')`),
      stat("Average attendance in the Chapel", "per service, last 12 months",
        `SELECT CAST(ROUND(AVG(count)) AS INT) FROM attendance_service
          WHERE org_id = :orgId AND room = 'chapel'
            AND week_date >= date('now','-365 day')`),
      chart("Chapel attendance by week", "headcount in the Chapel",
        `SELECT week_date AS "Week", SUM(count) AS "Attendance"
           FROM attendance_service
          WHERE org_id = :orgId AND room = 'chapel'
            AND week_date >= date('now','-730 day')
          GROUP BY 1 ORDER BY 1`, "line"),
      table("Chapel services", "average headcount per service time, last 12 months",
        `SELECT service AS "Service", CAST(ROUND(AVG(count)) AS INT) AS "Average",
                COUNT(*) AS "Weeks"
           FROM attendance_service
          WHERE org_id = :orgId AND room = 'chapel'
            AND week_date >= date('now','-365 day')
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: measuredNote(
      "the serving roster behind the Classic service and the attendance it drew.",
      "Attendance comes from a manually maintained sheet. Not measured: the congregation's experience of the service, or how the Classic and LIVE congregations overlap.",
    ),
  },

  "mir-worship-music": {
    metrics: [
      stat("Musicians and vocalists", "active members of a music or worship team",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND (lower(t.name) LIKE '%music%' OR lower(t.name) = 'choir'
                 OR lower(t.name) LIKE '%worship%')`, { color: "highlight" }),
      stat("In the choir", "active choir membership",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND lower(t.name) = 'choir'`),
      stat("Auditioned", "people on the Auditions team",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND t.name = 'Auditions'`),
      stat("Songs planned", "items on LIVE and CLASSIC plans, last 12 months",
        `SELECT COUNT(*) FROM pco_plan_items i
           JOIN pco_plans pl ON pl.pco_id = i.plan_id AND pl.org_id = :orgId
          WHERE i.org_id = :orgId AND pl.sort_date >= ${YEAR}
            AND pl.sort_date <= datetime('now')`),
      table("Music and worship teams", "active membership",
        `SELECT t.name AS "Team", COUNT(DISTINCT m.person_id) AS "Members"
           FROM pco_teams t
           JOIN pco_team_memberships m ON m.team_id = t.pco_id AND m.org_id = :orgId
            AND m.archived_at IS NULL AND m.person_id != ''
          WHERE t.org_id = :orgId
            AND (lower(t.name) LIKE '%music%' OR lower(t.name) = 'choir'
                 OR lower(t.name) LIKE '%worship%')
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: measuredNote(
      "the size of the music and worship teams and how much service content is planned.",
      "\"Songs planned\" counts every item on a service plan, not only songs — plan items are only synced for the LIVE and CLASSIC service types. Original music, rehearsal time and musical development are not tracked.",
    ),
  },

  "mir-technology-worship": {
    metrics: [
      stat("Production volunteers", "active members of a production or AV team",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND (lower(t.name) LIKE '%production%' OR lower(t.name) LIKE '%audio%'
                 OR lower(t.name) LIKE '%visual%')`, { color: "highlight" }),
      stat("Services supported", "LIVE and CLASSIC plans, last 12 months",
        `SELECT COUNT(DISTINCT pl.pco_id) FROM pco_plans pl
           JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
          WHERE pl.org_id = :orgId AND (st.name LIKE 'LIVE%' OR st.name LIKE 'CLASSIC%')
            AND pl.sort_date >= ${YEAR} AND pl.sort_date <= datetime('now')`),
      stat("Average live viewers", "the online service this team delivers",
        `SELECT CAST(ROUND(AVG(online_live)) AS INT) FROM attendance_weekly
          WHERE org_id = :orgId AND online_live IS NOT NULL
            AND week_date >= date('now','-365 day')`),
      table("Production teams", "active membership",
        `SELECT t.name AS "Team", COUNT(DISTINCT m.person_id) AS "Members"
           FROM pco_teams t
           JOIN pco_team_memberships m ON m.team_id = t.pco_id AND m.org_id = :orgId
            AND m.archived_at IS NULL AND m.person_id != ''
          WHERE t.org_id = :orgId
            AND (lower(t.name) LIKE '%production%' OR lower(t.name) LIKE '%audio%'
                 OR lower(t.name) LIKE '%visual%')
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: measuredNote(
      "the production volunteer roster, the services they support, and the online audience they reach.",
      "Not measured: equipment reliability, stream uptime, technical failures, or replacement cycles — none of it reaches a system we sync.",
    ),
  },

  "mir-facilities": {
    metrics: [
      stat("Facilities volunteers", "active members of a facilities or chair team",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND (lower(t.name) LIKE '%facilit%' OR lower(t.name) LIKE '%chair%')`,
        { color: "highlight" }),
      stat("Setup shifts filled", "chair and facilities assignments, last 12 months",
        `SELECT COUNT(*) FROM (${servingSlots("lower(st.name) LIKE '%chair%' OR lower(st.name) LIKE '%facilit%'")})
          WHERE sort_date >= ${YEAR}`),
      stat("Events to support", "plans across every service type, last 12 months",
        `SELECT COUNT(*) FROM pco_plans
          WHERE org_id = :orgId AND sort_date >= ${YEAR} AND sort_date <= datetime('now')`),
      table("Facilities teams", "active membership",
        `SELECT t.name AS "Team", COUNT(DISTINCT m.person_id) AS "Members"
           FROM pco_teams t
           JOIN pco_team_memberships m ON m.team_id = t.pco_id AND m.org_id = :orgId
            AND m.archived_at IS NULL AND m.person_id != ''
          WHERE t.org_id = :orgId
            AND (lower(t.name) LIKE '%facilit%' OR lower(t.name) LIKE '%chair%')
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: measuredNote(
      "the volunteer roster and the volume of events the building has to support.",
      "Not measured: work orders, maintenance cost, room utilisation, cleaning standards or capital condition. Facilities work is managed outside PCO entirely, so almost every published Output here is unmeasured.",
    ),
  },

  "mir-local-outreach": {
    metrics: [
      stat("Unleashing Servants", "active members of the Unleashing Servants team",
        `SELECT COUNT(DISTINCT m.person_id)
           FROM pco_team_memberships m
           JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
            AND lower(t.name) LIKE '%unleashing%'`, { color: "highlight" }),
      stat("Project assignments", "Unleashing Servants Projects slots, all time",
        `SELECT COUNT(*) FROM (${servingSlots("lower(st.name) LIKE '%unleashing%'")})`),
      stat("People on a project", "distinct volunteers, all time",
        `SELECT COUNT(DISTINCT person_id) FROM (${servingSlots("lower(st.name) LIKE '%unleashing%'")})`),
    ],
    gaps: measuredNote(
      "the Unleashing Servants roster and the project assignments recorded in PCO Services.",
      "The Unleashing Servants Projects service type has not been used since 2019, so the project figures are historical. Partnerships, hours served, and community need met are not recorded anywhere we sync.",
    ),
  },

  "mir-faith-preschool": {
    metrics: [
      stat("Preschool staff", "on the Preschool Staff reference list",
        `SELECT COUNT(*) FROM pco_list_memberships m
           JOIN pco_lists l ON l.pco_id = m.list_id AND l.org_id = :orgId
          WHERE m.org_id = :orgId AND l.name = 'REFERENCE - Preschool Staff'`,
        { color: "highlight" }),
      stat("Staff also serving", "preschool staff on an active team",
        `SELECT COUNT(DISTINCT tm.person_id)
           FROM pco_team_memberships tm
           JOIN pco_list_memberships m ON m.person_id = tm.person_id AND m.org_id = :orgId
           JOIN pco_lists l ON l.pco_id = m.list_id AND l.org_id = :orgId
          WHERE tm.org_id = :orgId AND tm.archived_at IS NULL AND tm.person_id != ''
            AND l.name = 'REFERENCE - Preschool Staff'`),
    ],
    gaps: measuredNote(
      "the staff roster, which is the only preschool data in PCO.",
      "Enrolment, families served, waiting lists, tuition, ratios and licensing all live in the preschool's own systems. Everything the report's Outputs ask for is unmeasured here until that data is brought in.",
    ),
  },

  "mir-service-planning": {
    metrics: [
      stat("Plans built", "across every service type, last 12 months",
        `SELECT COUNT(*) FROM pco_plans
          WHERE org_id = :orgId AND sort_date >= ${YEAR} AND sort_date <= datetime('now')`,
        { color: "highlight" }),
      stat("Service types in use", "with a plan in the last 12 months",
        `SELECT COUNT(DISTINCT st.pco_id) FROM pco_plans pl
           JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
          WHERE pl.org_id = :orgId AND pl.sort_date >= ${YEAR}
            AND pl.sort_date <= datetime('now')`),
      stat("People scheduled", "distinct volunteers across all plans, last 12 months",
        `SELECT COUNT(DISTINCT person_id) FROM (${servingSlots("1 = 1")})
          WHERE sort_date >= ${YEAR}`),
      stat("Assignments filled", "non-declined slots, last 12 months",
        `SELECT COUNT(*) FROM (${servingSlots("1 = 1")}) WHERE sort_date >= ${YEAR}`),
      chart("Planning volume by month", "plans built",
        `SELECT substr(sort_date,1,7) AS "Month", COUNT(*) AS "Plans"
           FROM pco_plans
          WHERE org_id = :orgId AND sort_date >= datetime('now','-730 day')
            AND sort_date <= datetime('now')
          GROUP BY 1 ORDER BY 1`, "area"),
      table("Busiest service types", "plans and volunteers, last 12 months",
        `SELECT service_type AS "Service type",
                COUNT(DISTINCT person_id) AS "Volunteers",
                COUNT(*) AS "Assignments"
           FROM (${servingSlots("1 = 1")})
          WHERE sort_date >= ${YEAR}
          GROUP BY 1 ORDER BY 3 DESC LIMIT 15`),
    ],
    gaps: measuredNote(
      "planning volume and the scheduling load across every service type in PCO Services.",
      "Not measured: how far ahead plans were finished, how often they changed late, or whether the planning process felt sustainable to the staff doing it — the published Outputs about lead time and rework have no data behind them.",
    ),
  },

  "mir-worship-original-music": {
    metrics: [
      stat("Sundays with an original song", "distinct service dates using a Faith Church song",
        `SELECT COUNT(DISTINCT used_on) FROM (${ORIGINAL_SONG_USES})`,
        {
          color: "highlight",
          detailLabel: "See every Sunday",
          revealsBlockTitle: "Every Sunday an original song was sung",
        }),
      stat("Times an original song was sung", "song-by-Sunday; both venues on one Sunday count once",
        `SELECT COUNT(*) FROM (SELECT DISTINCT song, used_on FROM (${ORIGINAL_SONG_USES}))`),
      stat("Songs in rotation", "distinct original songs used in a service",
        `SELECT COUNT(DISTINCT song) FROM (${ORIGINAL_SONG_USES})`,
        {
          detailLabel: "See which songs",
          revealsBlockTitle: "Every original song, and when it was sung",
        }),
      stat("Share of planned Sundays", "since 2024, of Sundays with a LIVE or CLASSIC plan",
        `SELECT ROUND(
             100.0 * (SELECT COUNT(DISTINCT used_on) FROM (${ORIGINAL_SONG_USES})
                       WHERE used_on >= '2024-01-01')
                   / NULLIF((SELECT COUNT(DISTINCT substr(pl.sort_date,1,10))
                               FROM pco_plans pl
                               JOIN pco_service_types st
                                 ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
                              WHERE pl.org_id = :orgId
                                AND (st.name LIKE 'LIVE%' OR st.name LIKE 'CLASSIC%')
                                AND pl.sort_date >= '2024-01-01'
                                AND pl.sort_date <= datetime('now')), 0), 0) || '%'`),
      table("Every Sunday an original song was sung",
        "opened by the Sundays card above",
        `SELECT used_on AS "Sunday",
                COUNT(DISTINCT song) AS "Songs",
                group_concat(DISTINCT printed_title) AS "Which",
                COUNT(DISTINCT service_type) AS "Rooms"
           FROM (${ORIGINAL_SONG_USES})
          GROUP BY used_on ORDER BY used_on DESC`, 12),
      chart("Original songs in services by year", "songs sung, and Sundays they were sung on",
        `SELECT substr(used_on,1,4) AS "Year",
                COUNT(*) AS "Songs sung",
                COUNT(DISTINCT used_on) AS "Sundays"
           FROM (SELECT DISTINCT song, used_on FROM (${ORIGINAL_SONG_USES}))
          GROUP BY 1 ORDER BY 1`, "bar"),
      chart("Where they are sung", "song-by-Sunday in each room; a song in both counts in both",
        `SELECT service_type AS "Service", COUNT(*) AS "Songs sung"
           FROM (SELECT DISTINCT song, used_on, service_type FROM (${ORIGINAL_SONG_USES}))
          GROUP BY 1 ORDER BY 2 DESC`, "donut"),
      stat("Songs released", "tracks on Spotify, across every release",
        `SELECT COUNT(*) FROM spotify_tracks WHERE org_id = :orgId`,
        {
          detailLabel: "See every track",
          revealsBlockTitle: "Released catalogue, and how often each song is sung",
        }),
      stat("Records put out", "albums, EPs and singles on Spotify",
        `SELECT COUNT(DISTINCT album_id) FROM spotify_tracks WHERE org_id = :orgId`,
        {
          detailLabel: "See the records",
          revealsBlockTitle: "Every record released",
        }),
      table("Every record released", "opened by the records card above",
        // Spotify calls a four-track record a "single" if the label registered
        // it that way, so album_type is its word, not ours.
        `SELECT album_name AS "Record",
                album_type AS "Spotify calls it",
                released_on AS "Released on",
                COUNT(*) AS "Tracks"
           FROM spotify_tracks
          WHERE org_id = :orgId
          GROUP BY album_id, album_name, album_type, released_on
          ORDER BY released_on DESC`, 12),
      table("Released catalogue, and how often each song is sung",
        "Spotify's own track list, matched to service plans by title",
        // Spotify titles carry a " (Live)" suffix the service plans don't, so
        // the join strips it. A released song with 0 uses is the interesting
        // row here — it means the church recorded something it never sings.
        // The alias is "Appears on", not "Release": the builder's read-only
        // engine rejects the word RELEASE (as in RELEASE SAVEPOINT) anywhere in
        // a query, alias included.
        //
        // Titles are stripped of a trailing " (Live)" with substr, NOT rtrim —
        // rtrim(name, ' (Live)') strips ANY trailing character from that set, so
        // a song called "Grace (Live)" would become "Grac".
        `SELECT t.name AS "Track",
                t.album_name AS "Appears on",
                t.released_on AS "Released on",
                COUNT(DISTINCT u.used_on) AS "Sundays sung"
           FROM spotify_tracks t
           LEFT JOIN (${ORIGINAL_SONG_USES}) u
             ON u.song = lower(trim(
                  CASE WHEN t.name LIKE '% (Live)'
                       THEN substr(t.name, 1, length(t.name) - 7)
                       ELSE t.name END))
          WHERE t.org_id = :orgId
          GROUP BY t.name, t.album_name, t.released_on
          ORDER BY 4 DESC, 1`, 12),
      table("Every original song, and when it was sung", "the exact titles this page matches on",
        // Grouped by the folded song, so a "(REPRISE)" doesn't appear as a
        // second song. MIN(printed_title) picks the plain title over the
        // "(REPRISE)" variant, which sorts after it.
        `SELECT MIN(printed_title) AS "Song",
                COUNT(DISTINCT used_on) AS "Sundays sung",
                MIN(used_on) AS "First sung",
                MAX(used_on) AS "Last sung"
           FROM (${ORIGINAL_SONG_USES})
          GROUP BY song ORDER BY 2 DESC, 1`, 12),
    ],
    gaps: {
      collapsible: true,
      title: "Every published Output, and whether we can measure it",
      intro:
        "The report lists twelve Outputs. Four are answered above; the rest have no data behind them, and this says why rather than leaving a blank. The catalogue table above lists the exact titles being matched — if a release is missing from it, it is missing from every number on this page.",
      items: [
        "- **# Total Sundays original song(s) are used in services** — measured. From PCO service plans.",
        "- **# of times a song is used in services** — measured. From PCO service plans.",
        "- **# songs released** — measured. Straight from Spotify's own catalogue for Faith Church Music.",
        "- **# songs produced** — partly. We can count what was *released* (5). Anything recorded and produced but never put out is invisible to Spotify, so treat this as a floor.",
        "- **# songs streamed** — not available. Stream counts are not in the Spotify Web API at any tier. Per-track play counts ARE public on the artist page (33,797 across the five tracks when last checked by hand), which is a page-scrape, not an API call.",
        "- **# Songs downloaded** and **demographic of downloads** — not available. Spotify is a streaming service and reports neither. Downloads would come from the distributor (DistroKid, CD Baby, TuneCore) or Apple Music; demographics live in Spotify for Artists, whose export is a manual CSV.",
        "- **# songs written** — not available. Nothing records a song that was written; only ones that reach a service plan or a release are visible here.",
        "- **# Creatives** and **Diversity of Creatives** — not available. There is no creatives roster in PCO. A team of songwriters would make both measurable immediately.",
        "- **# CCLI permissions** — not available. CCLI is a separate system we don't sync.",
        "- **% of worship volunteers who also create songs** — not available. The denominator exists (worship team membership); the numerator is the missing creatives roster above.",
        "- **Only LIVE and CLASSIC services are visible.** PCO plan items are synced for those two service types only, so an original song sung at Students, Prayer Works, a special service or a memorial does not appear. The Sunday and times-sung totals are floors, not ceilings.",
      ],
      footer:
        "_Follower count is not shown because Spotify does not return it for this app key — it omits the field entirely for keys in development mode, along with popularity and genres. A zero there would be wrong, not empty. Monthly listeners (96 when last checked) are public on the artist page but likewise absent from the API._",
    },
  },
};
