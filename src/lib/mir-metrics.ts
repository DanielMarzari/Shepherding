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

/** The Discover courses that count as adult discipleship events.
 *  Everything named "Discover ..." EXCEPT Discover Faith Church and Discover
 *  Membership — the ministry lead's rule: those two are the assimilation track,
 *  not discipleship. They live in PCO Registrations, not groups or check-ins.
 *  TRIM because several are stored with a trailing space ("Discover Jesus "). */
const DISCOVER_COURSES = `
  SELECT a.person_id, a.pco_created_at, TRIM(s.name) AS course
    FROM pco_registration_attendees a
    JOIN pco_registration_signups s
      ON s.org_id = a.org_id AND s.pco_id = a.signup_id
   WHERE a.org_id = :orgId
     AND a.canceled = 0
     AND a.person_id IS NOT NULL
     AND lower(TRIM(s.name)) LIKE 'discover%'
     AND lower(TRIM(s.name)) NOT LIKE 'discover faith church%'
     AND lower(TRIM(s.name)) NOT LIKE 'discover membership%'`;

const ADULT_DISCIPLESHIP_TYPES = `
  'Small Groups','Disciple-making Groups','ABF Groups',
  'Women''s AM Bible Studies','Women''s PM Bible Studies',
  'Mens'' Groups','Young Adults Groups','Seniors In Action (SIA)',
  'Organic Groups'`;

/** Adult discipleship memberships. Carries the group's own archived_at rather
 *  than filtering on it: PCO's archived groups are synced now, so a caller that
 *  means "currently" adds group_archived_at IS NULL, and a caller telling the
 *  story of a past year keeps them. */
const DISCIPLESHIP_MEMBERS = `
  SELECT m.person_id, gt.name AS type_name, m.role, m.joined_at,
         g.archived_at AS group_archived_at
    FROM pco_group_memberships m
    JOIN pco_groups g       ON g.pco_id = m.group_id       AND g.org_id = :orgId
    JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
   WHERE m.org_id = :orgId AND m.archived_at IS NULL
     AND gt.name IN (${ADULT_DISCIPLESHIP_TYPES})`;

/** Active memberships of the groups under one PCO group type. Active is about
 *  the membership; the GROUP may itself have been archived, and two thirds of
 *  this church's groups have been. Callers meaning "currently" add
 *  group_archived_at IS NULL; the history charts deliberately do not. */
const groupTypeMembers = (types: string) => `
  SELECT m.person_id, g.name AS group_name, m.role, m.joined_at,
         g.archived_at AS group_archived_at
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
      // PCO's archived groups sync now, so every current-state count below
      // filters group_archived_at — a group that wound up in 2021 must not
      // still read as running. The joins-by-year chart is the exception.
      stat("Engaged adults", "the denominator for every % below",
        `SELECT COUNT(*) FROM (${ENGAGED_ADULTS})`),
      stat("In a discipleship group", "engaged adults in an adult discipleship group",
        `SELECT COUNT(DISTINCT d.person_id)
           FROM (${DISCIPLESHIP_MEMBERS}) d
           JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
          WHERE d.group_archived_at IS NULL`, { color: "highlight" }),
      stat("% of congregation in a group", "share of engaged adults in a discipleship group",
        `SELECT ROUND(
             100.0 * (SELECT COUNT(DISTINCT d.person_id)
                        FROM (${DISCIPLESHIP_MEMBERS}) d
                        JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
                       WHERE d.group_archived_at IS NULL)
                   / NULLIF((SELECT COUNT(*) FROM (${ENGAGED_ADULTS})), 0), 1) || '%'`),
      stat("Discipleship group leaders", "engaged adults leading a group",
        `SELECT COUNT(DISTINCT d.person_id)
           FROM (${DISCIPLESHIP_MEMBERS}) d
           JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
          WHERE d.role = 'leader' AND d.group_archived_at IS NULL`),
      stat("Disciple-Making Groups", "people currently in a DMG",
        `SELECT COUNT(DISTINCT person_id) FROM (${DISCIPLESHIP_MEMBERS})
          WHERE type_name = 'Disciple-making Groups' AND group_archived_at IS NULL`),
      stat("Adults taking Next Steps", "in a worship, community, or serving lane",
        `SELECT COUNT(*) FROM person_activity pa
           JOIN pco_people p ON p.pco_id = pa.person_id AND p.org_id = :orgId
          WHERE pa.org_id = :orgId AND p.is_minor = 0
            AND (pa.in_lane_wors = 1 OR pa.in_lane_comm = 1 OR pa.in_lane_serv = 1)`),
      chart("Where adults are discipled", "engaged adults by group type",
        `SELECT d.type_name AS "Group type", COUNT(DISTINCT d.person_id) AS "Adults"
           FROM (${DISCIPLESHIP_MEMBERS}) d
           JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
          WHERE d.group_archived_at IS NULL
          GROUP BY 1 ORDER BY 2 DESC`, "bar", { colorByCategory: true }),
      // Archived groups belong in this one: a join in 2019 into a group that
      // has since wound up is still a join that happened in 2019.
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
            AND g.archived_at IS NULL
          GROUP BY g.name ORDER BY 2 DESC`),
      table("Discipleship reach by group type", "adults reached, and how many of them lead",
        `SELECT d.type_name AS "Group type",
                COUNT(DISTINCT d.person_id) AS "Adults",
                COUNT(DISTINCT CASE WHEN d.role = 'leader' THEN d.person_id END) AS "Leaders"
           FROM (${DISCIPLESHIP_MEMBERS}) d
           JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = d.person_id
          WHERE d.group_archived_at IS NULL
          GROUP BY 1 ORDER BY 2 DESC`),

      // ─── Added 2026-09-14. Two Outputs that had been listed as gaps are
      // measurable after all, from sources the app had never read: baptism is
      // a date on the "Membership and Assimilation" person tab, and the
      // Discover courses are PCO Registrations signups.
      stat("Baptisms recorded", "people with a baptism date on file",
        `SELECT COUNT(*) FROM pco_person_fields
          WHERE org_id = :orgId AND field_name = 'Baptism' AND value_date IS NOT NULL`,
        { color: "highlight" }),
      stat("Attended a Discover course", "distinct people, every course and year",
        `SELECT COUNT(DISTINCT person_id) FROM (${DISCOVER_COURSES})`),
      stat("% of engaged adults", "who have attended a Discover course",
        `SELECT ROUND(
             100.0 * (SELECT COUNT(DISTINCT c.person_id)
                        FROM (${DISCOVER_COURSES}) c
                        JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = c.person_id)
                   / NULLIF((SELECT COUNT(*) FROM (${ENGAGED_ADULTS})), 0), 1) || '%'`),
      // Dense year series on purpose: 2024 has no baptism recorded at all, and
      // a line that skips the year would join 2023 to 2025 as if nothing had
      // happened. A zero that is drawn is a question somebody can answer.
      chart("Baptisms by year", "from the Baptism date on each person's record",
        `WITH RECURSIVE yrs(y) AS (
           SELECT 2015
           UNION ALL SELECT y + 1 FROM yrs WHERE y < CAST(strftime('%Y','now') AS INTEGER)
         )
         SELECT CAST(yrs.y AS TEXT) AS "Year",
                COALESCE((SELECT COUNT(*) FROM pco_person_fields f
                           WHERE f.org_id = :orgId AND f.field_name = 'Baptism'
                             AND f.value_date IS NOT NULL
                             AND CAST(substr(f.value_date,1,4) AS INTEGER) = yrs.y), 0) AS "Baptisms"
           FROM yrs ORDER BY yrs.y`, "bar"),
      chart("Discover course attendance", "distinct people per course, all runs combined",
        `SELECT course AS "Course", COUNT(DISTINCT person_id) AS "People"
           FROM (${DISCOVER_COURSES})
          GROUP BY 1 ORDER BY 2 DESC`, "bar", { colorByCategory: true }),
      chart("Discover attendance by year", "distinct people attending a course each year",
        `SELECT substr(pco_created_at,1,4) AS "Year", COUNT(DISTINCT person_id) AS "People"
           FROM (${DISCOVER_COURSES})
          WHERE pco_created_at IS NOT NULL
          GROUP BY 1 ORDER BY 1`, "area"),
      table("Who attends which Discover course", "each course, its people, and how many are engaged adults",
        `SELECT c.course AS "Course",
                COUNT(DISTINCT c.person_id) AS "People",
                COUNT(DISTINCT CASE WHEN a.pco_id IS NOT NULL THEN c.person_id END) AS "Engaged adults",
                MIN(substr(c.pco_created_at,1,4)) AS "First run",
                MAX(substr(c.pco_created_at,1,4)) AS "Latest run"
           FROM (${DISCOVER_COURSES}) c
           LEFT JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = c.person_id
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: {
      intro:
        "These Outputs are in the published report but have no data behind them today. Listed here rather than dropped, so the gap is visible and fixable:",
      items: [
        "- **# of people who come to faith in Christ** — no faith-decision is recorded anywhere we sync. Needs a PCO form or workflow that stamps the person's record.",
        "- **% who attend Discipleship Workshops** — no check-in event or group type corresponds to the workshops.",
        "- **% who complete a Disciple-Making Group** — we can see current membership, not completion. Needs an archived-with-outcome convention, or a \"graduated\" list.",
        "- **% of DMG graduates who become leaders** — depends on completion above.",
        "- **Standardized spiritual growth inventory** — no instrument has been administered, so there is nothing to report.",
      ],
      footer:
        "_Baptisms come from the Baptism date on the Membership and Assimilation tab of a person's record — 1,006 people have one, back to 1942. **No baptism is recorded for 2024 at all**, between 111 in 2023 and 47 in 2025, which reads as a year nobody filled the field in rather than a year nobody was baptised. Discover attendance comes from PCO Registrations, counting everything named Discover except Discover Faith Church and Discover Membership; the date is when the person registered, not the night the class met, so a course running across a year boundary lands in the year it opened. The remaining live Outputs come from PCO group membership and the app's own lane classification._",
    },
  },

  "mir-small-groups": {
    metrics: [
      // The four cards and the sizes chart are the CURRENT picture, so they
      // filter group_archived_at: 222 of this church's groups are archived, so
      // "Active small groups" would otherwise read 153 instead of the 37 still
      // running.
      // Everything from the joins-by-year chart down is history and keeps them.
      stat("People in a small group", "active memberships, all ages",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'Small Groups'")})
          WHERE group_archived_at IS NULL`,
        { color: "highlight" }),
      stat("Active small groups", "groups of the Small Groups type",
        `SELECT COUNT(DISTINCT g.pco_id)
           FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE g.org_id = :orgId AND gt.name = 'Small Groups'
            AND g.archived_at IS NULL`),
      stat("Small group leaders", "members with the leader role",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'Small Groups'")})
          WHERE role = 'leader' AND group_archived_at IS NULL`),
      stat("% of engaged adults", "adults in a small group",
        `SELECT ROUND(
             100.0 * (SELECT COUNT(DISTINCT m.person_id)
                        FROM (${groupTypeMembers("'Small Groups'")}) m
                        JOIN (${ENGAGED_ADULTS}) a ON a.pco_id = m.person_id
                       WHERE m.group_archived_at IS NULL)
                   / NULLIF((SELECT COUNT(*) FROM (${ENGAGED_ADULTS})), 0), 1) || '%'`),
      chart("Group sizes", "members per small group",
        `SELECT group_name AS "Group", COUNT(DISTINCT person_id) AS "Members"
           FROM (${groupTypeMembers("'Small Groups'")})
          WHERE group_archived_at IS NULL
          GROUP BY 1 ORDER BY 2 DESC LIMIT 25`),
      // Archived groups stay in from here down: a 2019 join into a group that
      // has since wound up is still a 2019 join.
      chart("New small-group joins by year", "people joining a small group",
        `SELECT substr(joined_at,1,4) AS "Year", COUNT(DISTINCT person_id) AS "Joined"
           FROM (${groupTypeMembers("'Small Groups'")})
          WHERE joined_at IS NOT NULL AND substr(joined_at,1,4) >= '2019'
          GROUP BY 1 ORDER BY 1`, "area"),

      // ─── Outputs added 2026-09-05, on the session calendar the ministry
      // actually runs: Winter (Jan 1 – Mar 20), Spring (Mar 21 – Jun 30),
      // Fall (Sep 1 – Nov 30). July, August and December are off; the season
      // boundaries were checked against the meetings themselves, which show a
      // real two-to-four week gap in mid-March.
      //
      // These depend on two things that were missing until now: PCO's ARCHIVED
      // groups (222 of them, two thirds of this church's group history, never
      // synced because PCO's group list defaults to active-only), and the
      // per-person attendance records, which the rolling three-month sync
      // window had left at 2026 only until they were backfilled to 2019.
      chart("Attendance spread across groups, by session", "one box per session; each value inside it is a single group's attendance rate, so the width of the box is how differently groups are doing",
        `
        WITH att AS (
          SELECT
            e.group_id                  AS group_id,
            e.pco_id                    AS event_id,
            a.attended                  AS attended,
            strftime('%Y', e.starts_at) AS yr,
            CASE
              WHEN CAST(strftime('%m', e.starts_at) AS INTEGER) IN (1,2)
                OR (CAST(strftime('%m', e.starts_at) AS INTEGER) = 3
                    AND CAST(strftime('%d', e.starts_at) AS INTEGER) <= 20) THEN 'Winter'
              WHEN (CAST(strftime('%m', e.starts_at) AS INTEGER) = 3
                    AND CAST(strftime('%d', e.starts_at) AS INTEGER) > 20)
                OR CAST(strftime('%m', e.starts_at) AS INTEGER) IN (4,5,6)  THEN 'Spring'
              WHEN CAST(strftime('%m', e.starts_at) AS INTEGER) IN (9,10,11) THEN 'Fall'
              ELSE NULL
            END AS season
          FROM pco_event_attendances a
          JOIN pco_group_events e  ON e.org_id  = :orgId AND e.pco_id = a.event_id
          JOIN pco_groups       g  ON g.org_id  = :orgId AND g.pco_id = e.group_id
          JOIN pco_group_types  gt ON gt.org_id = :orgId AND gt.pco_id = g.group_type_id
          WHERE a.org_id = :orgId
            AND gt.name = 'Small Groups'
            AND COALESCE(e.canceled, 0) = 0
            AND e.starts_at IS NOT NULL
            AND e.starts_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
            AND CAST(strftime('%Y', e.starts_at) AS INTEGER) >= 2019
        ),
        group_session AS (
          -- One row per group per session: that group's own attendance rate.
          -- Floor of 3 recorded meetings drops sparsely-recorded groups.
          SELECT
            att.yr      AS yr,
            att.season  AS season,
            att.group_id AS group_id,
            ROUND(100.0 * SUM(COALESCE(att.attended, 0)) / NULLIF(COUNT(*), 0), 1) AS rate
          FROM att
          WHERE att.season IS NOT NULL
          GROUP BY att.yr, att.season, att.group_id
          HAVING COUNT(DISTINCT att.event_id) >= 3
        )
        SELECT
          gs.yr || ' ' || gs.season AS "Session",
          gs.rate                   AS "Group attendance %"
        FROM group_session gs
        WHERE gs.rate IS NOT NULL
          -- Session-level floor: never draw a box for a session until enough
          -- groups have reported, so a just-started session cannot render a
          -- distribution built from the two or three fastest-reporting groups.
          AND (SELECT COUNT(*) FROM group_session s2
                WHERE s2.yr = gs.yr AND s2.season = gs.season) >= 5
        ORDER BY gs.yr,
                 CASE gs.season WHEN 'Winter' THEN 1 WHEN 'Spring' THEN 2 ELSE 3 END`, "boxplot", { span: 12 }),
      chart("Attendance by session, year over year", "median rate across groups, one line per year — the overlay shows whether a session always dips",
        `
        WITH sessions(sess, sort) AS (
          VALUES ('Winter', 1), ('Spring', 2), ('Fall', 3)
        ),
        meeting AS (
          SELECT
            a.group_id,
            a.event_id,
            a.attended,
            strftime('%Y', e.starts_at) AS yr,
            CASE
              WHEN CAST(strftime('%m', e.starts_at) AS INTEGER) IN (1,2)
                OR (CAST(strftime('%m', e.starts_at) AS INTEGER) = 3
                    AND CAST(strftime('%d', e.starts_at) AS INTEGER) <= 20) THEN 'Winter'
              WHEN (CAST(strftime('%m', e.starts_at) AS INTEGER) = 3
                    AND CAST(strftime('%d', e.starts_at) AS INTEGER) > 20)
                OR CAST(strftime('%m', e.starts_at) AS INTEGER) IN (4,5,6) THEN 'Spring'
              WHEN CAST(strftime('%m', e.starts_at) AS INTEGER) IN (9,10,11) THEN 'Fall'
              ELSE NULL END AS sess
          FROM pco_event_attendances a
          JOIN pco_group_events e
            ON e.pco_id = a.event_id AND e.org_id = :orgId AND COALESCE(e.canceled, 0) = 0
          JOIN pco_groups g
            ON g.pco_id = a.group_id AND g.org_id = :orgId
          JOIN pco_group_types gt
            ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE a.org_id = :orgId
            AND gt.name = 'Small Groups'
            AND e.starts_at IS NOT NULL
            AND e.starts_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        ),
        group_session AS (
          SELECT yr, sess, group_id,
                 100.0 * SUM(attended) / NULLIF(COUNT(*), 0) AS rate
          FROM meeting
          WHERE sess IS NOT NULL AND yr >= '2019'
          GROUP BY yr, sess, group_id
          HAVING COUNT(DISTINCT event_id) >= 2
        ),
        ranked AS (
          SELECT yr, sess, rate,
                 ROW_NUMBER() OVER (PARTITION BY yr, sess ORDER BY rate) AS rn,
                 COUNT(*)     OVER (PARTITION BY yr, sess)               AS n
          FROM group_session
        ),
        med AS (
          SELECT yr, sess, ROUND(AVG(rate), 1) AS median_rate
          FROM ranked
          WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
          GROUP BY yr, sess
        )
        SELECT
          s.sess AS "Session",
          MAX(CASE WHEN m.yr = '2019' THEN m.median_rate END) AS "2019",
          MAX(CASE WHEN m.yr = '2020' THEN m.median_rate END) AS "2020",
          MAX(CASE WHEN m.yr = '2021' THEN m.median_rate END) AS "2021",
          MAX(CASE WHEN m.yr = '2022' THEN m.median_rate END) AS "2022",
          MAX(CASE WHEN m.yr = '2023' THEN m.median_rate END) AS "2023",
          MAX(CASE WHEN m.yr = '2024' THEN m.median_rate END) AS "2024",
          MAX(CASE WHEN m.yr = '2025' THEN m.median_rate END) AS "2025",
          MAX(CASE WHEN m.yr = '2026' THEN m.median_rate END) AS "2026"
        FROM sessions s
        LEFT JOIN med m ON m.sess = s.sess
        GROUP BY s.sess, s.sort
        ORDER BY s.sort`, "line", { span: 6 }),
      chart("Small groups per session", "groups alive in each session, with the change from the session before",
        `
        WITH RECURSIVE
        years(y) AS (
          SELECT 2018
          UNION ALL
          SELECT y + 1 FROM years WHERE y < CAST(strftime('%Y','now') AS INTEGER)
        ),
        session_spine(y, seq, session_name, starts_on, ends_on) AS (
          SELECT y, 1, 'Winter', y || '-01-01', y || '-03-20' FROM years
          UNION ALL
          SELECT y, 2, 'Spring', y || '-03-21', y || '-06-30' FROM years
          UNION ALL
          SELECT y, 3, 'Fall',   y || '-09-01', y || '-11-30' FROM years
        ),
        sessions AS (
          SELECT y, seq, y || ' ' || session_name AS label, starts_on, ends_on
          FROM session_spine
          WHERE starts_on <= date('now')
        ),
        small_groups AS (
          SELECT g.pco_id,
                 date(g.pco_created_at) AS created_on,
                 date(g.archived_at)    AS archived_on
          FROM pco_groups g
          JOIN pco_group_types gt
            ON gt.pco_id = g.group_type_id
           AND gt.org_id = :orgId
          WHERE g.org_id = :orgId
            AND gt.name = 'Small Groups'
        ),
        counted AS (
          SELECT s.y, s.seq, s.label, COUNT(sg.pco_id) AS n
          FROM sessions s
          LEFT JOIN small_groups sg
            ON sg.created_on <= s.ends_on
           AND (sg.archived_on IS NULL OR sg.archived_on >= s.starts_on)
          GROUP BY s.y, s.seq, s.label
        ),
        with_change AS (
          SELECT y, seq, label, n,
                 n - LAG(n) OVER (ORDER BY y, seq) AS delta
          FROM counted
        )
        SELECT
          label AS "Session",
          n     AS "Groups",
          delta AS "Change"
        FROM with_change
        WHERE y >= 2019
        ORDER BY y, seq;`, "combo", { span: 6 }),
      chart("Small group leaders per session", "distinct people leading a group that met, with the change from the session before",
        `
        WITH meetings AS (
          SELECT
            e.group_id                                   AS group_id,
            CAST(strftime('%Y', e.starts_at) AS INTEGER) AS yr,
            CASE
              WHEN CAST(strftime('%m', e.starts_at) AS INTEGER) IN (1,2)
                OR (CAST(strftime('%m', e.starts_at) AS INTEGER) = 3 AND CAST(strftime('%d', e.starts_at) AS INTEGER) <= 20) THEN 'Winter'
              WHEN (CAST(strftime('%m', e.starts_at) AS INTEGER) = 3 AND CAST(strftime('%d', e.starts_at) AS INTEGER) > 20)
                OR CAST(strftime('%m', e.starts_at) AS INTEGER) IN (4,5,6) THEN 'Spring'
              WHEN CAST(strftime('%m', e.starts_at) AS INTEGER) IN (9,10,11) THEN 'Fall'
              ELSE NULL END                              AS season
          FROM pco_group_events e
          JOIN pco_groups      g  ON g.pco_id  = e.group_id      AND g.org_id  = :orgId
          JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE e.org_id = :orgId
            AND gt.name  = 'Small Groups'
            AND COALESCE(e.canceled, 0) = 0
            AND datetime(e.starts_at) <= datetime('now')
            AND CAST(strftime('%Y', e.starts_at) AS INTEGER) >= 2019
        ),
        sessions AS (
          SELECT DISTINCT
            yr,
            season,
            -- Gap-free chronological ordinal: consecutive sessions differ by exactly 1,
            -- including across the year boundary (Fall 2019 = 6060, Winter 2020 = 6061).
            yr * 3 + (CASE season WHEN 'Winter' THEN 1 WHEN 'Spring' THEN 2 ELSE 3 END) AS ord,
            yr || ' ' || season AS label,
            CASE season WHEN 'Winter' THEN yr || '-01-01' WHEN 'Spring' THEN yr || '-03-21' ELSE yr || '-09-01' END AS session_start,
            CASE season WHEN 'Winter' THEN yr || '-03-20' WHEN 'Spring' THEN yr || '-06-30' ELSE yr || '-11-30' END AS session_end
          FROM meetings
          WHERE season IS NOT NULL
        ),
        live_groups AS (
          -- Groups ALIVE in the session, not groups with a MEETING on record.
          -- Meeting records only become reliable around Fall 2019: 2019 Spring
          -- has 4 groups with recorded meetings against 44 that existed, so
          -- gating on meetings read as 8 leaders that session and 67 the next —
          -- a change in record-keeping drawn as a change in leadership. This
          -- also matches the "Small groups per session" chart beside it, which
          -- has always counted groups this way.
          SELECT s2.yr, s2.season, g.pco_id AS group_id
            FROM sessions s2
            JOIN pco_groups g       ON g.org_id  = :orgId
            JOIN pco_group_types gt ON gt.org_id = :orgId AND gt.pco_id = g.group_type_id
           WHERE gt.name = 'Small Groups'
             AND date(g.pco_created_at) <= s2.session_end
             AND (g.archived_at IS NULL OR date(g.archived_at) >= s2.session_start)
        ),
        per_session AS (
          SELECT s.ord, s.label, COUNT(DISTINCT m.person_id) AS leaders
          FROM sessions s
          JOIN live_groups lg
            ON lg.yr = s.yr AND lg.season = s.season
          -- LEFT JOIN: a session whose meeting groups have no leader on record plots 0,
          -- instead of vanishing from the series as if the session never happened.
          LEFT JOIN pco_group_memberships m
            ON m.org_id   = :orgId
           AND m.group_id = lg.group_id
           AND m.role     = 'leader'
           AND date(m.joined_at) <= s.session_end
           AND (m.archived_at IS NULL OR date(m.archived_at) >= s.session_start)
          WHERE date(s.session_end) < date('now')
          GROUP BY s.ord, s.label
        )
        SELECT
          label    AS "Session",
          leaders  AS "Leaders",
          -- Only a genuinely adjacent session yields a delta. If the preceding session
          -- had no small-group meetings at all (e.g. Spring 2020), it is absent from the
          -- series and the change is NULL rather than a silent two-session jump.
          CASE WHEN LAG(ord) OVER (ORDER BY ord) = ord - 1
               THEN leaders - LAG(leaders) OVER (ORDER BY ord)
          END      AS "Change vs prior session"
        FROM per_session
        ORDER BY ord;`, "combo", { span: 6 }),
      chart("From application to leading a group", "every person who has applied to or joined a small group since 2016, and how far along they got",
        `
        WITH sg AS (                       -- every Small Groups group, archived ones included
          SELECT g.pco_id
            FROM pco_groups g
            JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
           WHERE g.org_id = :orgId AND gt.name = 'Small Groups'
        ),
        app AS (                           -- people who ever applied to a small group
          SELECT DISTINCT a.person_id AS person_id
            FROM pco_group_applications a
            JOIN sg ON sg.pco_id = a.group_id
           WHERE a.org_id = :orgId AND a.person_id IS NOT NULL
        ),
        mem AS (                           -- people who ever held a small-group membership
          SELECT DISTINCT m.person_id AS person_id
            FROM pco_group_memberships m
            JOIN sg ON sg.pco_id = m.group_id
           WHERE m.org_id = :orgId AND m.person_id IS NOT NULL
        ),
        led AS (                           -- of those, the ones holding a leader role anywhere
          SELECT DISTINCT m.person_id AS person_id
            FROM pco_group_memberships m
            JOIN sg ON sg.pco_id = m.group_id
           WHERE m.org_id = :orgId AND m.person_id IS NOT NULL AND m.role = 'leader'
        ),
        led_also_member AS (               -- leaders who are also a plain member of a DIFFERENT small group
          SELECT DISTINCT l.person_id AS person_id
            FROM pco_group_memberships l
            JOIN sg lg ON lg.pco_id = l.group_id
            JOIN pco_group_memberships o
              ON o.org_id = :orgId AND o.person_id = l.person_id AND o.group_id <> l.group_id
            JOIN sg og ON og.pco_id = o.group_id
           WHERE l.org_id = :orgId AND l.role = 'leader' AND o.role = 'member'
             AND l.person_id IS NOT NULL
        ),
        flows AS (
          SELECT 'Applied to join' AS "From", 'In a group' AS "To",
                 (SELECT COUNT(*) FROM app WHERE person_id IN (SELECT person_id FROM mem)) AS "People"
          UNION ALL SELECT 'Applied to join', 'Applied, never in a group',
                 (SELECT COUNT(*) FROM app WHERE person_id NOT IN (SELECT person_id FROM mem))
          UNION ALL SELECT 'Added without applying', 'In a group',
                 (SELECT COUNT(*) FROM mem WHERE person_id NOT IN (SELECT person_id FROM app))
          UNION ALL SELECT 'In a group', 'Leads a group',
                 (SELECT COUNT(*) FROM led)
          UNION ALL SELECT 'In a group', 'Member only',
                 (SELECT COUNT(*) FROM mem WHERE person_id NOT IN (SELECT person_id FROM led))
          UNION ALL SELECT 'Leads a group', 'Also a member elsewhere',
                 (SELECT COUNT(*) FROM led_also_member)
          UNION ALL SELECT 'Leads a group', 'Leads only',
                 (SELECT COUNT(*) FROM led WHERE person_id NOT IN (SELECT person_id FROM led_also_member))
        )
        -- Drop zero-count bands: the block renderer coerces a 0 link value to 1
        -- (echarts-block.tsx renders a zero as num(r[2]) || 1), which would draw a phantom
        -- person and unbalance the node it hangs off. Removing a 0 changes no sum,
        -- so every node still balances exactly.
        SELECT "From", "To", "People"
          FROM flows
         WHERE "People" > 0;`, "sankey", { span: 12 }),
      chart("Other next steps among small group members", "people in a small group who are also serving or giving",
        `
        WITH sg AS (
          SELECT DISTINCT gm.person_id AS person_id
            FROM pco_group_memberships gm
            JOIN pco_groups       g  ON g.org_id  = gm.org_id AND g.pco_id  = gm.group_id
            JOIN pco_group_types  gt ON gt.org_id = g.org_id  AND gt.pco_id = g.group_type_id
           WHERE gm.org_id = :orgId
             AND gt.name = 'Small Groups'
             AND g.archived_at  IS NULL
             AND gm.archived_at IS NULL
        ),
        flags AS (
          SELECT sg.person_id,
                 CASE WHEN EXISTS (SELECT 1 FROM pco_team_memberships tm
                                    WHERE tm.org_id = :orgId
                                      AND tm.person_id = sg.person_id
                                      AND tm.archived_at IS NULL) THEN 1 ELSE 0 END AS serving,
                 CASE WHEN EXISTS (SELECT 1 FROM pushpay_donors d
                                    WHERE d.org_id = :orgId
                                      AND d.person_id = sg.person_id) THEN 1 ELSE 0 END AS giving
            FROM sg
        )
        SELECT "Next step", "People" FROM (
          SELECT 'In a small group'       AS "Next step", COUNT(*) AS "People", 1 AS ord FROM flags
          UNION ALL
          SELECT 'Also serving on a team', COALESCE(SUM(serving), 0), 2 FROM flags
          UNION ALL
          SELECT 'Also giving',            COALESCE(SUM(giving), 0),  3 FROM flags
          UNION ALL
          SELECT 'Serving and giving',
                 COALESCE(SUM(CASE WHEN serving = 1 AND giving = 1 THEN 1 ELSE 0 END), 0), 4 FROM flags
        ) ORDER BY ord`, "bar", { span: 6 }),
      chart("Share of the church in a small group", "against three different denominators, because they disagree",
        `
        WITH sg AS (
          SELECT DISTINCT gm.person_id AS person_id
            FROM pco_group_memberships gm
            JOIN pco_groups       g  ON g.org_id  = gm.org_id AND g.pco_id  = gm.group_id
            JOIN pco_group_types  gt ON gt.org_id = g.org_id  AND gt.pco_id = g.group_type_id
           WHERE gm.org_id = :orgId
             AND gt.name = 'Small Groups'
             AND g.archived_at  IS NULL
             AND gm.archived_at IS NULL
        ),
        aw_ok AS (
          SELECT aw.in_person_total AS n
            FROM attendance_weekly aw
           WHERE aw.org_id = :orgId
             AND aw.in_person_total IS NOT NULL
             AND aw.week_date >= date('now', '-365 day')
             AND aw.week_date <= date('now')
             AND (aw.exception_reason IS NULL OR (
                      lower(aw.exception_reason) NOT LIKE '%snow%'
                  AND lower(aw.exception_reason) NOT LIKE '%sleet%'
                  AND lower(aw.exception_reason) NOT LIKE '%icy%'
                  AND ' ' || lower(aw.exception_reason) || ' ' NOT LIKE '% ice %'
                  AND lower(aw.exception_reason) NOT LIKE '%storm%'
                  AND lower(aw.exception_reason) NOT LIKE '%blizzard%'
                  AND lower(aw.exception_reason) NOT LIKE '%hurricane%'
                  AND lower(aw.exception_reason) NOT LIKE '%weather%'
                  AND lower(aw.exception_reason) NOT LIKE '%clos%'
                  AND lower(aw.exception_reason) NOT LIKE '%cancel%'
                  AND lower(aw.exception_reason) NOT LIKE '%no service%'
                  AND lower(aw.exception_reason) NOT LIKE '%did not meet%'
                  AND lower(aw.exception_reason) NOT LIKE '%didn%meet%'
                  AND lower(aw.exception_reason) NOT LIKE '%outage%'
                  AND lower(aw.exception_reason) NOT LIKE '%power out%'
                  AND lower(aw.exception_reason) NOT LIKE '%covid%'
                  AND lower(aw.exception_reason) NOT LIKE '%pandemic%'
                  AND lower(aw.exception_reason) NOT LIKE '%quarantine%'
                  AND lower(aw.exception_reason) NOT LIKE '%flood%'
             ))
        ),
        awa AS (
          SELECT AVG(n) AS avg_weekly, COUNT(*) AS weeks FROM aw_ok
        )
        SELECT "Population", "% in a small group" FROM (
          SELECT '% of active people' AS "Population",
                 ROUND(100.0 * COUNT(sg.person_id) / NULLIF(COUNT(*), 0), 1) AS "% in a small group",
                 1 AS ord
            FROM person_activity pa
            LEFT JOIN sg ON sg.person_id = pa.person_id
           WHERE pa.org_id = :orgId
             AND pa.classification <> 'inactive'
          UNION ALL
          SELECT '% of members',
                 ROUND(100.0 * COUNT(sg.person_id) / NULLIF(COUNT(*), 0), 1), 2
            FROM pco_people p
            LEFT JOIN sg ON sg.person_id = p.pco_id
           WHERE p.org_id = :orgId
             AND lower(p.membership_type) LIKE '%member%'
             AND lower(p.membership_type) NOT LIKE '%former%'
             AND lower(p.membership_type) NOT LIKE '%non-member%'
             AND lower(p.membership_type) NOT LIKE '%non member%'
             AND lower(p.membership_type) NOT LIKE '%nonmember%'
             AND lower(p.membership_type) NOT LIKE '%system use%'
             AND lower(COALESCE(p.status, '')) <> 'inactive'
             AND p.inactivated_at IS NULL
          UNION ALL
          SELECT '% of average weekly attendance',
                 ROUND(100.0 * (SELECT COUNT(*) FROM sg)
                             / NULLIF((SELECT avg_weekly FROM awa WHERE weeks >= 26), 0), 1), 3
        ) ORDER BY ord`, "bar", { span: 6 }),
    ],
    gaps: measuredNote(
      "groups and leaders per session including groups since archived, each group's own attendance rate per session from PCO's per-person records, the path from application to leading, and the share of the church in a small group.",
      "Attendance is only as complete as the groups that take it: 22 to 27 of them submit sheets in a given session, and a group that never takes roll is absent from the spread rather than counted low. The rate is against the group's roster, so a group that leaves departed members on its list reads the same as one whose members stopped coming. PCO records no leave date on a membership, so leader counts mean \u201chad become a leader by then, in a group still running\u201d rather than a roster for that week. Multiplication, curriculum progress and leader-development milestones are still recorded nowhere.",
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
      // Children and mums are split by ROOM, never by the is_minor flag.
      // is_minor means "under 18 as of the last sync", so a 17-year-old who
      // came to VBX 2024 and has since turned 18 would quietly move out of that
      // year's children — a past year's number changing because time passed.
      // The rooms are an exact partition: every location is entirely minors
      // except Moms' Class, and the two sets never overlap.
      stat("Children at the last VBX", "distinct children checked into any room but the Moms' Class",
        `SELECT COUNT(DISTINCT c.person_id)
           FROM pco_check_ins c
           JOIN pco_checkin_events e ON e.pco_id = c.event_id AND e.org_id = :orgId
           LEFT JOIN pco_checkin_locations l ON l.pco_id = c.location_id AND l.org_id = :orgId
          WHERE c.org_id = :orgId
       AND e.name LIKE 'VBX%' AND e.name <> 'VBX Middle School'
       AND c.event_time_at IS NOT NULL AND c.event_time_at <> ''
            AND (l.name NOT LIKE '%Moms%Class%' OR l.name IS NULL)
            -- The latest VBX EVENT, resolved from the four-row events table.
            -- Deriving the year by scanning 275k check-ins instead cost 6.4s a block.
            AND c.event_id = (SELECT e2.pco_id FROM pco_checkin_events e2
                               WHERE e2.org_id = :orgId AND e2.name LIKE 'VBX%'
                                 AND e2.name <> 'VBX Middle School'
                               ORDER BY e2.pco_created_at DESC LIMIT 1)`,
        { color: "highlight" }),
      stat("Mums in the Moms' Class", "distinct adults in the Moms' Class at the last VBX",
        `SELECT COUNT(DISTINCT c.person_id)
           FROM pco_check_ins c
           JOIN pco_checkin_events e ON e.pco_id = c.event_id AND e.org_id = :orgId
           JOIN pco_checkin_locations l ON l.pco_id = c.location_id AND l.org_id = :orgId
          WHERE c.org_id = :orgId
       AND e.name LIKE 'VBX%' AND e.name <> 'VBX Middle School'
       AND c.event_time_at IS NOT NULL AND c.event_time_at <> ''
            AND l.name LIKE '%Moms%Class%'
            -- The latest VBX EVENT, resolved from the four-row events table.
            -- Deriving the year by scanning 275k check-ins instead cost 6.4s a block.
            AND c.event_id = (SELECT e2.pco_id FROM pco_checkin_events e2
                               WHERE e2.org_id = :orgId AND e2.name LIKE 'VBX%'
                                 AND e2.name <> 'VBX Middle School'
                               ORDER BY e2.pco_created_at DESC LIMIT 1)`),
      stat("Selections offered", "rooms children could sign up for at the last VBX",
        `SELECT COUNT(DISTINCT c.location_id)
           FROM pco_check_ins c
           JOIN pco_checkin_events e ON e.pco_id = c.event_id AND e.org_id = :orgId
          WHERE c.org_id = :orgId
       AND e.name LIKE 'VBX%' AND e.name <> 'VBX Middle School'
       AND c.event_time_at IS NOT NULL AND c.event_time_at <> '' AND c.location_id IS NOT NULL
            -- The latest VBX EVENT, resolved from the four-row events table.
            -- Deriving the year by scanning 275k check-ins instead cost 6.4s a block.
            AND c.event_id = (SELECT e2.pco_id FROM pco_checkin_events e2
                               WHERE e2.org_id = :orgId AND e2.name LIKE 'VBX%'
                                 AND e2.name <> 'VBX Middle School'
                               ORDER BY e2.pco_created_at DESC LIMIT 1)`),
      stat("High school teens on Mission Serve", "confirmed on the most recent trip",
        `SELECT COUNT(DISTINCT CASE WHEN p.birth_year IS NOT NULL
                 AND (CAST(substr(s.pco_created_at,1,4) AS INTEGER) - p.birth_year) BETWEEN 13 AND 19
                 THEN a.person_id END)
           FROM pco_registration_signups s
           JOIN pco_registration_attendees a ON a.signup_id = s.pco_id AND a.org_id = :orgId
           LEFT JOIN pco_people p ON p.pco_id = a.person_id AND p.org_id = :orgId
          WHERE s.org_id = :orgId AND a.canceled = 0 AND a.person_id IS NOT NULL
            AND lower(s.name) LIKE '%mission serve%high school%'
            AND substr(s.pco_created_at,1,4) = (
              SELECT MAX(substr(s2.pco_created_at,1,4)) FROM pco_registration_signups s2
               WHERE s2.org_id = :orgId AND lower(s2.name) LIKE '%mission serve%high school%')`),
      // Stacked, not a combo: 7-22 mums against 327-534 children on one shared
      // value axis puts the mums line flat on the axis, unreadable. Stacked
      // keeps both in the same unit — people — and the bar height is the week.
      chart("VBX attendance by year", "everyone who came, split by the room they were in",
        `SELECT substr(c.event_time_at,1,4) AS "VBX",
                COUNT(DISTINCT CASE WHEN l.name NOT LIKE '%Moms%Class%' OR l.name IS NULL
                                    THEN c.person_id END) AS "Children",
                COUNT(DISTINCT CASE WHEN l.name LIKE '%Moms%Class%' THEN c.person_id END) AS "Mums"
           FROM pco_check_ins c
           JOIN pco_checkin_events e ON e.pco_id = c.event_id AND e.org_id = :orgId
           LEFT JOIN pco_checkin_locations l ON l.pco_id = c.location_id AND l.org_id = :orgId
          WHERE c.org_id = :orgId
       AND e.name LIKE 'VBX%' AND e.name <> 'VBX Middle School'
       AND c.event_time_at IS NOT NULL AND c.event_time_at <> ''
          GROUP BY 1 ORDER BY 1`, "stacked-bar"),
      chart("The Moms' Class", "its own chart, because 7 to 22 mums vanish beside 500 children",
        `SELECT substr(c.event_time_at,1,4) AS "VBX",
                COUNT(DISTINCT c.person_id) AS "Mums",
                COUNT(*) AS "Check-ins"
           FROM pco_check_ins c
           JOIN pco_checkin_events e ON e.pco_id = c.event_id AND e.org_id = :orgId
           JOIN pco_checkin_locations l ON l.pco_id = c.location_id AND l.org_id = :orgId
          WHERE c.org_id = :orgId
       AND e.name LIKE 'VBX%' AND e.name <> 'VBX Middle School'
       AND c.event_time_at IS NOT NULL AND c.event_time_at <> '' AND l.name LIKE '%Moms%Class%'
          GROUP BY 1 ORDER BY 1`, "combo"),
      chart("Attendance through the week", "distinct people each day, the three weeks overlaid",
        `WITH days AS (
           SELECT substr(c.event_time_at,1,4) AS yr, substr(c.event_time_at,1,10) AS d, c.person_id
             FROM pco_check_ins c
             JOIN pco_checkin_events e ON e.pco_id = c.event_id AND e.org_id = :orgId
            WHERE c.org_id = :orgId
       AND e.name LIKE 'VBX%' AND e.name <> 'VBX Middle School'
       AND c.event_time_at IS NOT NULL AND c.event_time_at <> ''
         ),
         ranked AS (
           SELECT yr, DENSE_RANK() OVER (PARTITION BY yr ORDER BY d) AS day_no, person_id FROM days
         )
         SELECT 'Day ' || day_no AS "Day",
                COUNT(DISTINCT CASE WHEN yr='2024' THEN person_id END) AS "2024",
                COUNT(DISTINCT CASE WHEN yr='2025' THEN person_id END) AS "2025",
                COUNT(DISTINCT CASE WHEN yr='2026' THEN person_id END) AS "2026"
           FROM ranked GROUP BY day_no ORDER BY day_no`, "line"),
      chart("High school teens on Mission Serve", "confirmed teens against everyone on the trip",
        `SELECT substr(s.pco_created_at,1,4) AS "Year",
                COUNT(DISTINCT CASE WHEN p.birth_year IS NOT NULL
                      AND (CAST(substr(s.pco_created_at,1,4) AS INTEGER) - p.birth_year) BETWEEN 13 AND 19
                      THEN a.person_id END) AS "High school teens",
                COUNT(DISTINCT a.person_id) AS "On the trip"
           FROM pco_registration_signups s
           JOIN pco_registration_attendees a ON a.signup_id = s.pco_id AND a.org_id = :orgId
           LEFT JOIN pco_people p ON p.pco_id = a.person_id AND p.org_id = :orgId
          WHERE s.org_id = :orgId AND a.canceled = 0 AND a.person_id IS NOT NULL
            AND lower(s.name) LIKE '%mission serve%high school%'
          GROUP BY 1 ORDER BY 1`, "bar"),
      table("Every selection at the last VBX", "the room each person signed up for — team names are re-themed yearly, so this does not compare with a prior year",
        `SELECT COALESCE(NULLIF(TRIM(CASE WHEN TRIM(l.name) LIKE 'Team: %'
                                          THEN substr(TRIM(l.name), 7) ELSE TRIM(l.name) END), ''),
                         'No selection recorded') AS "Selection",
                COUNT(DISTINCT c.person_id) AS "People",
                COUNT(*) AS "Check-ins",
                COUNT(DISTINCT substr(c.event_time_at,1,10)) AS "Days running"
           FROM pco_check_ins c
           JOIN pco_checkin_events e ON e.pco_id = c.event_id AND e.org_id = :orgId
           LEFT JOIN pco_checkin_locations l ON l.pco_id = c.location_id AND l.org_id = :orgId
          WHERE c.org_id = :orgId
            AND c.event_time_at IS NOT NULL AND c.event_time_at <> ''
            AND c.event_id = (SELECT e2.pco_id FROM pco_checkin_events e2
                               WHERE e2.org_id = :orgId AND e2.name LIKE 'VBX%'
                                 AND e2.name <> 'VBX Middle School'
                               ORDER BY e2.pco_created_at DESC LIMIT 1)
          GROUP BY 1 ORDER BY 2 DESC, 3 DESC`, 12),
    ],
    gaps: {
      intro:
        "These Outputs are in the published report with no data behind them. One is a system that exists and is not being used; the rest have no source at all:",
      items: [
        "- **Volunteers — both Outputs.** No check-in in this data is marked as a volunteer, and no VBX volunteer roster reaches PCO at all. The ministry lead's own words: volunteers are not in PCO right now, and they should be. **The records exist — Patti has them** — so this is a question of getting them into the system, not of measuring something unmeasurable. Until then neither the count of returning volunteers nor their retention can be answered.",
        "- **Friendship connections (# friends brought to VBX)** — nothing records who invited whom, and the lead's own read is that this cannot be known.",
        "- **# memory verses learned** — recorded by the ministry, not in PCO.",
        "- **# kids crossing the line of faith** — same: the ministry knows, PCO does not.",
        "- **# Bibles given out**, **incidents of children lost**, **God stories collected**, **# of relationships formed among volunteers** — none of these touches a system we sync.",
      ],
      footer:
        "_Children and mums are split by the ROOM they were in, never by an age flag. The app's is_minor means \u201cunder 18 as of the last sync\u201d, so a seventeen-year-old who came in 2024 and has since turned eighteen would quietly leave that year\u2019s children — a past number changing because time passed. The rooms are an exact partition here: every location is entirely minors except the Moms\u2019 Class, and no one appears in both. \u201cMums\u201d means whoever was checked into that room; nothing in the data confirms they are mothers, or tells attending apart from staffing it. The 2019 \u201cVBX Middle School\u201d event is excluded — it was middle-school only, not the full week, and 48 people beside 2024-2026 would read as a collapse that never happened. Team names are re-themed every year (astronauts, then colours, then cabins), so the selections table describes one year and cannot be trended. Mission Serve teens come from the Registrations roster, where every attendee has a birth year, so the teen count is exact rather than inferred — but 2023 to 2025 are APPLICATION forms and 2026 is a ROSTER, which is why the chart shows everyone on the trip beside the teens._",
    },
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
      // Scoped to the PRAYER WORKS service type, NOT to any team whose name
      // contains "prayer". That older filter returned 208 people because it
      // swept in the 182-strong Network Prayer Team — the email prayer network,
      // a different ministry with a different job. A PrayerWorks report counting
      // them as prayer partners overstates the roster sixfold.
      stat("Serving as a prayer partner", "distinct people scheduled in the last 12 months",
        `SELECT COUNT(*) FROM (
  SELECT DISTINCT pp.person_id
    FROM pco_plan_people pp
    JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE pp.org_id = :orgId AND pp.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'
     AND pl.sort_date >= date('now','-365 day') AND pl.sort_date <= date('now'))`, { color: "highlight" }),
      stat("On the team roster", "tagged onto a PrayerWorks team right now",
        `SELECT COUNT(*) FROM (
  SELECT DISTINCT m.person_id
    FROM pco_team_memberships m
    JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = t.service_type_id AND st.org_id = :orgId
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%')`),
      stat("Serving without being tagged", "scheduled in the last 12 months, not on any roster",
        `SELECT COUNT(*) FROM (
  SELECT DISTINCT pp.person_id
    FROM pco_plan_people pp
    JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE pp.org_id = :orgId AND pp.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'
     AND pl.sort_date >= date('now','-365 day') AND pl.sort_date <= date('now')) s
          WHERE s.person_id NOT IN (SELECT person_id FROM (
  SELECT DISTINCT m.person_id
    FROM pco_team_memberships m
    JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = t.service_type_id AND st.org_id = :orgId
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'))`),
      stat("Prayer partners ever", "distinct people scheduled since PrayerWorks began, Oct 2020",
        `SELECT COUNT(*) FROM (
  SELECT pp.person_id,
         MIN(date(pl.sort_date)) AS first_served,
         MAX(date(pl.sort_date)) AS last_served,
         COUNT(DISTINCT pl.pco_id) AS times
    FROM pco_plan_people pp
    JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE pp.org_id = :orgId AND pp.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'
     AND pl.sort_date <= date('now')
   GROUP BY pp.person_id)`),
      chart("Roster against who actually serves", "the two lists are not the same people",
        `WITH roster AS (
  SELECT DISTINCT m.person_id
    FROM pco_team_memberships m
    JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = t.service_type_id AND st.org_id = :orgId
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'), served AS (
  SELECT DISTINCT pp.person_id
    FROM pco_plan_people pp
    JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE pp.org_id = :orgId AND pp.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'
     AND pl.sort_date >= date('now','-365 day') AND pl.sort_date <= date('now'))
         SELECT 'On the roster' AS "Group", (SELECT COUNT(*) FROM roster) AS "People"
         UNION ALL SELECT 'Served, last 12 months', (SELECT COUNT(*) FROM served)
         UNION ALL SELECT 'On the roster, did not serve',
           (SELECT COUNT(*) FROM roster WHERE person_id NOT IN (SELECT person_id FROM served))
         UNION ALL SELECT 'Served, not on the roster',
           (SELECT COUNT(*) FROM served WHERE person_id NOT IN (SELECT person_id FROM roster))`,
        "bar", { colorByCategory: true }),
      chart("Retention by the year they started", "how many of each year's new partners are still serving",
        `SELECT substr(first_served,1,4) AS "Started",
                COUNT(*) AS "Partners",
                ROUND(100.0 * SUM(CASE WHEN last_served >= date('now','-365 day') THEN 1 ELSE 0 END)
                      / NULLIF(COUNT(*), 0), 1) AS "% still serving"
           FROM (
  SELECT pp.person_id,
         MIN(date(pl.sort_date)) AS first_served,
         MAX(date(pl.sort_date)) AS last_served,
         COUNT(DISTINCT pl.pco_id) AS times
    FROM pco_plan_people pp
    JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE pp.org_id = :orgId AND pp.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'
     AND pl.sort_date <= date('now')
   GROUP BY pp.person_id)
          GROUP BY 1 ORDER BY 1`, "combo"),
      table("Every prayer partner, first served to last", "the span each partner has served, and whether they are still tagged on the team",
        `WITH span AS (
  SELECT pp.person_id,
         MIN(date(pl.sort_date)) AS first_served,
         MAX(date(pl.sort_date)) AS last_served,
         COUNT(DISTINCT pl.pco_id) AS times
    FROM pco_plan_people pp
    JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE pp.org_id = :orgId AND pp.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'
     AND pl.sort_date <= date('now')
   GROUP BY pp.person_id), roster AS (
  SELECT DISTINCT m.person_id
    FROM pco_team_memberships m
    JOIN pco_teams t ON t.pco_id = m.team_id AND t.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = t.service_type_id AND st.org_id = :orgId
   WHERE m.org_id = :orgId AND m.archived_at IS NULL AND m.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%')
         SELECT COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), '#' || s.person_id) AS "Partner",
                s.first_served AS "First served",
                s.last_served AS "Last served",
                CAST(ROUND((julianday(s.last_served) - julianday(s.first_served)) / 30.44) AS INTEGER) AS "Months serving",
                s.times AS "Times",
                CAST(ROUND((julianday('now') - julianday(s.last_served)) / 30.44) AS INTEGER) AS "Months since",
                CASE WHEN r.person_id IS NOT NULL THEN 'yes' ELSE 'no' END AS "Still on team"
           FROM span s
           LEFT JOIN roster r ON r.person_id = s.person_id
           LEFT JOIN pco_people p ON p.pco_id = s.person_id AND p.org_id = :orgId
          ORDER BY s.last_served DESC, s.first_served`, 12),
      table("Average tenure by starting year", "how long each year's partners lasted",
        `SELECT substr(first_served,1,4) AS "Started",
                COUNT(*) AS "Partners",
                SUM(CASE WHEN last_served >= date('now','-365 day') THEN 1 ELSE 0 END) AS "Still serving",
                CAST(ROUND(AVG((julianday(last_served) - julianday(first_served)) / 30.44)) AS INTEGER) AS "Avg months serving"
           FROM (
  SELECT pp.person_id,
         MIN(date(pl.sort_date)) AS first_served,
         MAX(date(pl.sort_date)) AS last_served,
         COUNT(DISTINCT pl.pco_id) AS times
    FROM pco_plan_people pp
    JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
    JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
   WHERE pp.org_id = :orgId AND pp.person_id != ''
     AND st.name LIKE 'PRAYER WORKS%'
     AND pl.sort_date <= date('now')
   GROUP BY pp.person_id)
          GROUP BY 1 ORDER BY 1`),
      stat("Network prayer requests", "Network Prayer Request form, all time — a DIFFERENT intake to PrayerWorks",
        `SELECT COUNT(*) FROM pco_form_submissions s
           JOIN pco_forms f ON f.pco_id = s.form_id AND f.org_id = :orgId
          WHERE s.org_id = :orgId AND f.name = 'Network Prayer Request'`),
      chart("Network prayer requests by month", "the online form, not the prayer cards handed in at PrayerWorks",
        `SELECT substr(s.pco_created_at,1,7) AS "Month", COUNT(*) AS "Requests"
           FROM pco_form_submissions s
           JOIN pco_forms f ON f.pco_id = s.form_id AND f.org_id = :orgId
          WHERE s.org_id = :orgId AND f.name = 'Network Prayer Request'
            AND s.pco_created_at >= datetime('now','-730 day')
          GROUP BY 1 ORDER BY 1`, "area"),
    ],
    gaps: {
      intro:
        "These Outputs are in the published report and have no data behind them. One of them is a process gap worth fixing rather than a limit of the system:",
      items: [
        "- **Prayer cards are not recorded anywhere.** PCO holds exactly three forms — Network Prayer Request, Serve Form and Membership Application — and none of them is the prayer card handed in at PrayerWorks. The ministry lead's own read is that those requests go out by email instead, which means the count of people who came to PrayerWorks for prayer, the requests they brought, and anything that followed all leave no trace. **This is the single change that would make Outputs 3, 4, 5 and 6 answerable**: put the prayer card into a PCO form.",
        "- **# of testimonies of answered prayers** — nothing records an outcome against a request, so a prayer that was answered looks identical to one that was not.",
        "- **# of Next Steps taken as a result of a visit to Prayer Works** — needs a visit to be recorded first. See above.",
        "- **% of adult attendees coming to Prayer Works for prayer** — the numerator does not exist. Sunday attendance is a headcount, so even a visit count could not be turned into a share of attendees without knowing who was in the building.",
        "- **% year over year of the same** — depends on the above.",
      ],
      footer:
        "_Prayer partners are scoped to the **PRAYER WORKS** service type. A previous version counted any team with \u201cprayer\u201d in its name and reported 208, which swept in the 182-strong Network Prayer Team — the email prayer network, a different ministry. Serving comes from who was actually scheduled on a plan, not the roster: the PrayerWorks Sunday Team carries no membership rows at all yet appears on plans constantly, so a roster count alone would have read zero. PrayerWorks plans begin 11 October 2020, so no partner can show a span longer than that, and nobody\u2019s tenure before that date is visible._",
    },
  },

  "mir-sunday-teaching": {
    metrics: [
      stat("Average Sunday on campus", "in the room, last 12 months",
        `SELECT CAST(ROUND(AVG(in_person_total)) AS INT) FROM attendance_weekly
          WHERE org_id = :orgId AND in_person_total IS NOT NULL
            AND week_date >= date('now','-365 day')`, { color: "highlight" }),
      stat("Average Sunday online", "live plus on demand, last 12 months",
        `SELECT CAST(ROUND(AVG(COALESCE(online_live,0) + COALESCE(online_on_demand,0))) AS INT)
           FROM attendance_weekly
          WHERE org_id = :orgId AND (online_live IS NOT NULL OR online_on_demand IS NOT NULL)
            AND week_date >= date('now','-365 day')`),
      stat("Baptisms in the last year", "from the Baptism date on each person's record",
        `SELECT COUNT(*) FROM pco_person_fields
          WHERE org_id = :orgId AND field_name = 'Baptism'
            AND value_date IS NOT NULL AND value_date >= date('now','-365 day')`),
      stat("People giving", "gave at least once in the last 12 months",
        `SELECT COUNT(DISTINCT person_id) FROM pushpay_donors
          WHERE org_id = :orgId AND person_id IS NOT NULL
            AND last_gift_date IS NOT NULL AND last_gift_date >= date('now','-365 day')`),
      chart("Sunday attendance", "on campus, live online, and on demand — every Sunday on the sheet",
        `SELECT week_date AS "Week",
                in_person_total AS "On campus",
                online_live AS "Online live",
                online_on_demand AS "On demand"
           FROM attendance_weekly
          WHERE org_id = :orgId AND week_date >= date('now','-730 day')
          ORDER BY week_date`, "line", { span: 12 }),
      chart("On campus and online, year by year", "average Sunday — the room has grown while online has settled",
        `SELECT substr(week_date,1,4) AS "Year",
                CAST(ROUND(AVG(in_person_total)) AS INT) AS "On campus",
                CAST(ROUND(AVG(COALESCE(online_live,0) + COALESCE(online_on_demand,0))) AS INT) AS "Online"
           FROM attendance_weekly
          WHERE org_id = :orgId AND substr(week_date,1,4) >= '2021'
          GROUP BY 1 ORDER BY 1`, "bar"),
      chart("Sermons by year", "how much teaching we have captured",
        `SELECT substr(preached_on,1,4) AS "Year", COUNT(*) AS "Sermons"
           FROM sermons WHERE org_id = :orgId AND preached_on IS NOT NULL
          GROUP BY 1 ORDER BY 1`, "bar"),
      // The analysis queue. A sermon arrives from Sermon Lab every Wednesday
      // with its transcript and NO classification — running a model unattended
      // from cron is not something to set going, so new sermons wait here to be
      // analysed on request. Empty is the healthy state.
      stat("Sermons awaiting analysis", "transcribed, not yet classified",
        `SELECT COUNT(*) FROM sermons
          WHERE org_id = :orgId AND classified_at IS NULL
            AND transcript IS NOT NULL AND transcript <> ''`),
      stat("Most recent sermon", "latest message on record",
        `SELECT COALESCE(MAX(preached_on),'none') FROM sermons WHERE org_id = :orgId`),
      table("Waiting to be analysed", "each one has a transcript and no classification yet — empty means the log is current",
        `SELECT preached_on AS "Preached",
                COALESCE(title,'(untitled)') AS "Title",
                COALESCE(speaker,'?') AS "Speaker",
                word_count AS "Words"
           FROM sermons
          WHERE org_id = :orgId AND classified_at IS NULL
            AND transcript IS NOT NULL AND transcript <> ''
          ORDER BY preached_on DESC LIMIT 25`),
      table("What Sunday leads to", "where the congregation has got to — each row counts distinct people",
        `SELECT 'In a small group' AS "Next step",
                (SELECT COUNT(DISTINCT gm.person_id)
                   FROM pco_group_memberships gm
                   JOIN pco_groups g ON g.pco_id = gm.group_id AND g.org_id = :orgId
                   JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
                  WHERE gm.org_id = :orgId AND gm.archived_at IS NULL
                    AND g.archived_at IS NULL AND gt.name = 'Small Groups') AS "People"
         UNION ALL SELECT 'Serving on a team',
                (SELECT COUNT(DISTINCT person_id) FROM pco_team_memberships
                  WHERE org_id = :orgId AND archived_at IS NULL AND person_id <> '')
         UNION ALL SELECT 'Giving (last 12 months)',
                (SELECT COUNT(DISTINCT person_id) FROM pushpay_donors
                  WHERE org_id = :orgId AND person_id IS NOT NULL
                    AND last_gift_date IS NOT NULL AND last_gift_date >= date('now','-365 day'))
         UNION ALL SELECT 'A member',
                (SELECT COUNT(*) FROM pco_people
                  WHERE org_id = :orgId AND membership_type = 'Member')
         UNION ALL SELECT 'Baptised (all on record)',
                (SELECT COUNT(*) FROM pco_person_fields
                  WHERE org_id = :orgId AND field_name = 'Baptism' AND value_date IS NOT NULL)
         UNION ALL SELECT 'Small groups running',
                (SELECT COUNT(*) FROM pco_groups g
                   JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
                  WHERE g.org_id = :orgId AND gt.name = 'Small Groups' AND g.archived_at IS NULL)`),
      table("Average Sunday, year by year", "with the number of Sundays each average rests on",
        `SELECT substr(week_date,1,4) AS "Year",
                CAST(ROUND(AVG(in_person_total)) AS INT) AS "On campus",
                CAST(ROUND(AVG(COALESCE(online_live,0) + COALESCE(online_on_demand,0))) AS INT) AS "Online",
                COUNT(*) AS "Sundays counted"
           FROM attendance_weekly
          WHERE org_id = :orgId AND substr(week_date,1,4) >= '2021'
          GROUP BY 1 ORDER BY 1`),
      table("Who preaches", "sermons by speaker",
        `SELECT speaker AS "Speaker", COUNT(*) AS "Sermons",
                MAX(substr(preached_on,1,10)) AS "Most recent"
           FROM sermons
          WHERE org_id = :orgId AND speaker IS NOT NULL AND trim(speaker) != ''
          GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    ],
    gaps: {
      intro:
        "The rest of the published Outputs, split by whether the data is coming or genuinely is not. **TO DO** means somebody is already working on the source:",
      items: [
        "- **TO DO — # of sermon views.** Online viewing lives with whoever runs the stream; nothing reaches this app yet.",
        "- **TO DO — # of new givers.** The PushPay export we import is a donor snapshot with a last-gift date, not a gift history, so a first-ever gift cannot be dated. Expected once fuller giving data arrives.",
        "- **TO DO — # participants in Extraordinary Giving Projects.** Steve is granting access to the giving records; not here yet.",
        "- **TO DO — # of people serving in VBX and the Christmas Tree Lighting.** Neither is marked in PCO Services, so there is no roster to count. Once they are scheduled like other teams this becomes the same query as the serving count above.",
        "- **TO DO — Sunday attendance from check-ins.** Attendance above is the manually maintained sheet. PCO check-ins already carry a room-by-room Sunday count; once a Sunday check-in event is nominated (see Settings → Filters) this page can read the real thing instead. **The sheet currently stops at 24 May 2026** — 2026 shows 21 Sundays against 52 in every full year, so this year's averages rest on January to May only.",
        "- **TO DO — Care groups, both Outputs.** Small groups are counted above; there is no care-group structure in PCO to count. The nearest thing is a \u201cCare Ministries\u201d group type holding 2 groups, which is not the same thing.",
        "- **# of people who cross the line of faith** — no faith decision is recorded anywhere we sync.",
        "- **# of people leading or mentoring** — group and team leaders are known, but mentoring is not recorded.",
        "- **Average $ per giver per year** — the import carries who gave and when, never how much. This one is not a matter of waiting: without amounts the figure cannot be produced here at all.",
        "- **Annual spiritual health survey** and **# spiritual gift tests** — neither instrument has been run, so there is nothing to report.",
        "- **Ratio of members to annual meeting votes** — vote counts are not in any system we read.",
      ],
      footer:
        "_Sermons arrive from the Sermon Lab app every Wednesday morning, transcribed and unclassified, and wait in the queue above until somebody asks for them to be analysed — a cron job does not invoke a model on its own. The mirror is one-for-one with Sermon Lab: 429 of Faith Church's 429. Attendance is the manually maintained weekly sheet, which is why it is a headcount and not a list of names — and why 2026 is short. Giving counts people whose PushPay donor record matches a person and who gave inside the last twelve months; the all-time matched figure is far larger because it includes everyone who has ever given. Sermons mirror the Sermon Lab app one-for-one — 429 of Faith Church's 429 — so nothing is missing on this side; the most recent is 3 August 2026, which is how far Sermon Lab's own feed has ingested._",
    },
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
      // Every block here is a standing roster, so all of them drop archived
      // groups — a care community that has wound up is not still wrapped
      // around a family, and a closed partner is not still a partner.
      stat("People connected", "active members of a Foster & Adoption group",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'Foster Adopt Volunteers','Foster Adopt Organizations','Foster Adopt Care Communities'")})
          WHERE group_archived_at IS NULL`,
        { color: "highlight" }),
      stat("Volunteers", "in the Foster Adopt Volunteers groups",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'Foster Adopt Volunteers'")})
          WHERE group_archived_at IS NULL`),
      stat("Care communities", "wrap-around groups around a family",
        `SELECT COUNT(DISTINCT g.pco_id) FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE g.org_id = :orgId AND gt.name = 'Foster Adopt Care Communities'
            AND g.archived_at IS NULL`),
      stat("Partner organisations", "agencies and partners tracked as groups",
        `SELECT COUNT(DISTINCT g.pco_id) FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE g.org_id = :orgId AND gt.name = 'Foster Adopt Organizations'
            AND g.archived_at IS NULL`),
      chart("Where people are connected", "by group type",
        `SELECT gt.name AS "Group type", COUNT(DISTINCT m.person_id) AS "People"
           FROM pco_group_memberships m
           JOIN pco_groups g       ON g.pco_id = m.group_id       AND g.org_id = :orgId
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE m.org_id = :orgId AND m.archived_at IS NULL AND gt.name LIKE 'Foster%'
            AND g.archived_at IS NULL
          GROUP BY 1 ORDER BY 2 DESC`, "bar", { colorByCategory: true }),
    ],
    gaps: measuredNote(
      "who is connected to the ministry through PCO groups — volunteers, care communities and partner organisations.",
      "Not measured: placements supported, children served, or family outcomes. Those live with the agencies, not in PCO.",
    ),
  },

  "mir-english-as-a-second-language": {
    metrics: [
      // All four are the classes running now, so archived groups are dropped:
      // a class that finished years ago is not a class the ministry teaches.
      //
      // 10 of the 14 carry the leader role, so this is everyone attached to an
      // ESL group — teachers included — not a student count.
      stat("People connected", "everyone in an ESL group, teachers included",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'ESL (non-PTS)'")})
          WHERE group_archived_at IS NULL`,
        { color: "highlight" }),
      stat("ESL groups", "classes tracked as PCO groups",
        `SELECT COUNT(DISTINCT g.pco_id) FROM pco_groups g
           JOIN pco_group_types gt ON gt.pco_id = g.group_type_id AND gt.org_id = :orgId
          WHERE g.org_id = :orgId AND gt.name = 'ESL (non-PTS)'
            AND g.archived_at IS NULL`),
      stat("Group leaders", "members with the leader role",
        `SELECT COUNT(DISTINCT person_id) FROM (${groupTypeMembers("'ESL (non-PTS)'")})
          WHERE role = 'leader' AND group_archived_at IS NULL`),
      table("ESL groups", "membership by class",
        `SELECT group_name AS "Group", COUNT(DISTINCT person_id) AS "People"
           FROM (${groupTypeMembers("'ESL (non-PTS)'")})
          WHERE group_archived_at IS NULL
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
      // The venue is THE CHAPEL AT 9:30, per the ministry lead — not "the
      // chapel". The chapel also seats an 11:00/11:15 service, and averaging
      // the room together mixes two congregations into one number.
      stat("Average weekly attendance", "the Chapel at 9:30, last 12 months",
        `SELECT CAST(ROUND(AVG(count)) AS INT) FROM attendance_service
          WHERE org_id = :orgId AND room = 'chapel' AND service = '9:30'
            AND week_date >= date('now','-365 day')`, { color: "highlight" }),
      stat("Weeks on record", "Sundays counted in the Chapel at 9:30",
        `SELECT COUNT(*) FROM attendance_service
          WHERE org_id = :orgId AND room = 'chapel' AND service = '9:30'`),
      stat("Volunteers serving", "distinct people on a Classic or Chapel PrayerWorks crew, last 12 months",
        `SELECT COUNT(DISTINCT pp.person_id)
           FROM pco_plan_people pp
           JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
           JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
           LEFT JOIN pco_teams t ON t.pco_id = pp.team_id AND t.org_id = :orgId
          WHERE pp.org_id = :orgId AND pp.person_id IS NOT NULL AND pp.person_id != ''
            AND (st.name LIKE 'CLASSIC SERVICE%'
              OR (st.name = 'PRAYER WORKS' AND lower(t.name) LIKE '%chapel%'))
            AND pl.sort_date >= date('now','-365 day') AND pl.sort_date <= date('now')`),
      stat("Services planned", "Classic services in the last 12 months",
        `SELECT COUNT(DISTINCT pl.pco_id) FROM pco_plans pl
           JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
          WHERE pl.org_id = :orgId AND st.name LIKE 'CLASSIC SERVICE%'
            AND pl.sort_date >= date('now','-365 day') AND pl.sort_date <= date('now')`),
      chart("Attendance by week", "headcount in the Chapel at 9:30, every Sunday on record",
        `SELECT week_date AS "Week", count AS "Attendance"
           FROM attendance_service
          WHERE org_id = :orgId AND room = 'chapel' AND service = '9:30'
          ORDER BY week_date`, "line", { span: 12 }),
      chart("Average weekly attendance, year to year", "the bar is the average Sunday; the line is the change on the year before",
        `WITH y AS (
           SELECT substr(week_date,1,4) AS yr, ROUND(AVG(count),1) AS avg_att
             FROM attendance_service
            WHERE org_id = :orgId AND room = 'chapel' AND service = '9:30'
            GROUP BY 1
         )
         SELECT yr AS "Year", avg_att AS "Average Sunday",
                ROUND(100.0 * (avg_att - LAG(avg_att) OVER (ORDER BY yr))
                      / NULLIF(LAG(avg_att) OVER (ORDER BY yr), 0), 1) AS "% change"
           FROM y ORDER BY yr`, "combo"),
      // From 2020 on purpose. The Classic plans go back to 2012 and every year
      // has somebody scheduled, but 2019 records 101 filled slots against 929
      // in 2020 — before 2020 only the speaker and worship leader went into
      // PCO, not the crews. Starting earlier would draw a change in
      // record-keeping as a tenfold jump in volunteering.
      chart("Volunteers by year", "distinct people who served the Classic or Chapel PrayerWorks, 2020 on",
        `SELECT substr(pl.sort_date,1,4) AS "Year",
                COUNT(DISTINCT pp.person_id) AS "Volunteers"
           FROM pco_plan_people pp
           JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
           JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
           LEFT JOIN pco_teams t ON t.pco_id = pp.team_id AND t.org_id = :orgId
          WHERE pp.org_id = :orgId AND pp.person_id IS NOT NULL AND pp.person_id != ''
            AND (st.name LIKE 'CLASSIC SERVICE%'
              OR (st.name = 'PRAYER WORKS' AND lower(t.name) LIKE '%chapel%'))
            AND pl.sort_date <= date('now') AND substr(pl.sort_date,1,4) >= '2020'
          GROUP BY 1 ORDER BY 1`, "area"),
      table("Attendance year to year", "average Sunday in the Chapel at 9:30, and how many Sundays that average rests on",
        `WITH y AS (
           SELECT substr(week_date,1,4) AS yr, ROUND(AVG(count),1) AS avg_att, COUNT(*) AS weeks
             FROM attendance_service
            WHERE org_id = :orgId AND room = 'chapel' AND service = '9:30'
            GROUP BY 1
         )
         SELECT yr AS "Year", avg_att AS "Average Sunday", weeks AS "Sundays counted",
                ROUND(100.0 * (avg_att - LAG(avg_att) OVER (ORDER BY yr))
                      / NULLIF(LAG(avg_att) OVER (ORDER BY yr), 0), 1) AS "% change"
           FROM y ORDER BY yr`),
      table("The crews", "who serves the Classic, by team, last 12 months",
        `SELECT COALESCE(t.name,'(no team)') AS "Crew",
                COUNT(DISTINCT pp.person_id) AS "Volunteers",
                COUNT(*) AS "Slots filled"
           FROM pco_plan_people pp
           JOIN pco_plans pl ON pl.pco_id = pp.plan_id AND pl.org_id = :orgId
           JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = :orgId
           LEFT JOIN pco_teams t ON t.pco_id = pp.team_id AND t.org_id = :orgId
          WHERE pp.org_id = :orgId AND pp.person_id IS NOT NULL AND pp.person_id != ''
            AND (st.name LIKE 'CLASSIC SERVICE%'
              OR (st.name = 'PRAYER WORKS' AND lower(t.name) LIKE '%chapel%'))
            AND pl.sort_date >= date('now','-365 day') AND pl.sort_date <= date('now')
          GROUP BY 1 ORDER BY 2 DESC`),
    ],
    gaps: {
      intro:
        "These Outputs are in the published report and cannot be answered from the data we hold. The reason is the same for nearly all of them, and it is worth stating once: **attendance in the Chapel is a headcount, not a list of names.** Nobody checks in to the 9:30 Classic, so we know how many came and never who:",
      items: [
        "- **% of attendees actively engaged in the service** — singing, giving attention and the rest are not observable in any system. The ministry lead's own note: too broad to measure as written, and it needs breaking into parts somebody can actually count.",
        "- **# of visitors per year** — a visitor is only identifiable if they identify themselves. Nothing at the 9:30 Classic asks them to.",
        "- **% of attendance taking steps on the Pathway** — the Pathway lanes are per person; Chapel attendance is per Sunday. The two cannot be joined without knowing who was in the room.",
        "- **# from Classic baptized / becoming members / Family Dedications** — all three are recorded per person (baptism now is, on the person record), but none of them records which service that person attends.",
        "- **% that check kids into Kids' Ministry** — kids check-ins carry the child, not which service the parent sat in.",
        "- **Ratio of historic attendees versus others** — depends on identifying the room, as above.",
        "- **Retention rate of volunteers** — the roster is measurable and is above; retention needs a definition from the ministry (served again within how long?) before it means anything.",
      ],
      footer:
        "_Attendance is the manually maintained service sheet, scoped to **room = chapel, service = 9:30** — the chapel also seats an 11:00/11:15 service, and averaging the room together would mix two congregations. 2026 rests on 20 Sundays (January to May), so its average is a part-year figure against full years elsewhere, and the year-to-year table shows the Sunday count beside every average for exactly that reason. Volunteers are people actually scheduled on a plan, not team rosters: several Chapel crews carry no membership rows at all yet appear on plans every week._",
    },
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
