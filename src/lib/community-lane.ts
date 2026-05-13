import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { getExcludedGroupTypes } from "./pco";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

// ─── Per-person group attendance (used by /people/[slug]) ──────────────

export interface PersonGroupAttendance {
  groupId: string;
  groupName: string | null;
  groupTypeName: string | null;
  isCurrentMember: boolean;
  membershipArchivedAt: string | null;
  attendedCount: number;
  totalEventCount: number;
  firstAttendedAt: string | null;
  lastAttendedAt: string | null;
}

/**
 * Every group this person has touched — current memberships AND any group
 * they attended an event for, even if they aren't a member anymore.
 * Surfaces the "they were here, then they weren't" pattern that PCO loses
 * by simply removing the membership row.
 */
export function listGroupsAttendedByPerson(
  orgId: number,
  personId: string,
): PersonGroupAttendance[] {
  const rows = getDb()
    .prepare(
      `WITH person_groups AS (
         SELECT DISTINCT m.group_id
           FROM pco_group_memberships m
           WHERE m.org_id = ? AND m.person_id = ?
         UNION
         SELECT DISTINCT a.group_id
           FROM pco_event_attendances a
           WHERE a.org_id = ? AND a.person_id = ? AND a.group_id IS NOT NULL
       )
       SELECT
         g.pco_id            AS groupId,
         g.name              AS groupName,
         t.name              AS groupTypeName,
         (SELECT 1
            FROM pco_group_memberships m
            WHERE m.org_id = g.org_id
              AND m.group_id = g.pco_id
              AND m.person_id = ?
              AND m.archived_at IS NULL
            LIMIT 1) AS isCurrentMember,
         (SELECT m.archived_at
            FROM pco_group_memberships m
            WHERE m.org_id = g.org_id
              AND m.group_id = g.pco_id
              AND m.person_id = ?
            ORDER BY m.archived_at DESC NULLS LAST
            LIMIT 1) AS membershipArchivedAt,
         (SELECT COUNT(*)
            FROM pco_event_attendances a
            WHERE a.org_id = g.org_id
              AND a.group_id = g.pco_id
              AND a.person_id = ?
              AND a.attended = 1) AS attendedCount,
         (SELECT COUNT(*)
            FROM pco_event_attendances a
            WHERE a.org_id = g.org_id
              AND a.group_id = g.pco_id
              AND a.person_id = ?) AS totalEventCount,
         (SELECT MIN(a.event_starts_at)
            FROM pco_event_attendances a
            WHERE a.org_id = g.org_id
              AND a.group_id = g.pco_id
              AND a.person_id = ?
              AND a.attended = 1) AS firstAttendedAt,
         (SELECT MAX(a.event_starts_at)
            FROM pco_event_attendances a
            WHERE a.org_id = g.org_id
              AND a.group_id = g.pco_id
              AND a.person_id = ?
              AND a.attended = 1) AS lastAttendedAt
       FROM pco_groups g
       JOIN person_groups pg ON pg.group_id = g.pco_id
       LEFT JOIN pco_group_types t
         ON t.org_id = g.org_id AND t.pco_id = g.group_type_id
       WHERE g.org_id = ?
       ORDER BY isCurrentMember DESC, lastAttendedAt DESC NULLS LAST, g.name ASC`,
    )
    .all(
      orgId, personId, // person_groups CTE
      orgId, personId,
      personId, // isCurrentMember subquery
      personId, // membershipArchivedAt
      personId, // attendedCount
      personId, // totalEventCount
      personId, // firstAttendedAt
      personId, // lastAttendedAt
      orgId,    // outer WHERE
    ) as Array<{
    groupId: string;
    groupName: string | null;
    groupTypeName: string | null;
    isCurrentMember: number | null;
    membershipArchivedAt: string | null;
    attendedCount: number;
    totalEventCount: number;
    firstAttendedAt: string | null;
    lastAttendedAt: string | null;
  }>;

  return rows.map((r) => ({
    groupId: r.groupId,
    groupName: r.groupName,
    groupTypeName: r.groupTypeName,
    isCurrentMember: !!r.isCurrentMember,
    membershipArchivedAt: r.membershipArchivedAt,
    attendedCount: r.attendedCount,
    totalEventCount: r.totalEventCount,
    firstAttendedAt: r.firstAttendedAt,
    lastAttendedAt: r.lastAttendedAt,
  }));
}

export interface CommunityPersonRow {
  pcoId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  groupCount: number;
  joinedFirstAt: string | null;
}

export interface CommunityLaneStats {
  /** People with at least one active group membership in a non-excluded group. */
  members: number;
  /** Distinct active groups (non-excluded). */
  groups: number;
  /** Members who joined within the activity-tracking window. */
  joinedRecently: number;
  /** People whose only memberships are in excluded types. */
  excludedOnly: number;
}

function nonExcludedJoin(
  excludedGroupTypes: string[],
): { join: string; args: string[] } {
  const join = `
    JOIN pco_groups g
      ON g.org_id = m.org_id
     AND g.pco_id = m.group_id
  `;
  if (excludedGroupTypes.length === 0) {
    return { join, args: [] };
  }
  const placeholders = excludedGroupTypes.map(() => "?").join(",");
  return {
    join: `
      ${join}
       AND (g.group_type_id IS NULL OR g.group_type_id NOT IN (${placeholders}))
    `,
    args: excludedGroupTypes,
  };
}

export function getCommunityLaneStats(
  orgId: number,
  trackingMonths: number,
): CommunityLaneStats {
  const db = getDb();
  const excludedGroupTypes = getExcludedGroupTypes(orgId);
  const trackingCutoff = new Date(
    Date.now() - trackingMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { join, args: joinArgs } = nonExcludedJoin(excludedGroupTypes);

  // "Members" for the Community lane = anyone who is currently a member or
  // leader of a non-excluded group. We DON'T apply the person-level
  // membership_type filter here — even if the person is e.g. classified
  // "staff" by PCO, being in a group is what makes them Community.
  const memberRow = db
    .prepare(
      `SELECT
         COUNT(DISTINCT m.person_id) AS members,
         COUNT(DISTINCT m.group_id) AS groups,
         COUNT(DISTINCT CASE WHEN m.joined_at IS NOT NULL AND m.joined_at >= ? THEN m.person_id END) AS joinedRecently
       FROM pco_group_memberships m
       ${join}
       WHERE m.org_id = ?
         AND m.archived_at IS NULL`,
    )
    .get(trackingCutoff, ...joinArgs, orgId) as {
    members: number;
    groups: number;
    joinedRecently: number;
  };

  // People whose only memberships fall in excluded types.
  const excludedOnly =
    excludedGroupTypes.length === 0
      ? 0
      : ((db
          .prepare(
            `SELECT COUNT(DISTINCT person_id) AS n FROM pco_group_memberships m
              WHERE m.org_id = ?
                AND m.archived_at IS NULL
                AND m.person_id NOT IN (
                  SELECT m2.person_id
                    FROM pco_group_memberships m2
                    JOIN pco_groups g2 ON g2.org_id = m2.org_id AND g2.pco_id = m2.group_id
                   WHERE m2.org_id = ?
                     AND m2.archived_at IS NULL
                     AND (g2.group_type_id IS NULL OR g2.group_type_id NOT IN (${excludedGroupTypes
                       .map(() => "?")
                       .join(",")}))
                )`,
          )
          .get(orgId, orgId, ...excludedGroupTypes) as { n: number }).n);

  return {
    members: memberRow.members,
    groups: memberRow.groups,
    joinedRecently: memberRow.joinedRecently,
    excludedOnly,
  };
}

// ─── Groups list (used by /groups) ─────────────────────────────────────

export interface SyncedGroupRow {
  pcoId: string;
  name: string | null;
  schedule: string | null;
  groupTypeName: string | null;
  /** Active members + leaders (non-archived, non-lapsed). */
  members: number;
  /** Subset of `members` whose role flags them as a leader. */
  leaders: number;
  joinedRecently: number;
  /** People considered "out" within tracking window: archived in window
   *  OR attended-then-disappeared OR active-but-lapsed (lapsed counts as
   *  having left the group). */
  leftRecently: number;
  recentEvents: number;
  /** % of `recentEvents` that had attendance actually recorded. Null when
   *  there are no events in the window. 0% means events happened but no
   *  one took attendance — distinct from "100% of members were absent." */
  attendanceTakenPct: number | null;
  /** % of active members who attended at least once in the tracking window.
   *  Null when no attendance was taken (can't measure). When attendance
   *  WAS taken, 0% is a real (concerning) signal. */
  attendancePct: number | null;
  pcoCreatedAt: string | null;
  archivedAt: string | null;
  state: "growing" | "shrinking" | "steady" | "paused";
}

export function listGroups(
  orgId: number,
  trackingMonths: number,
  lapsedWeeks: number,
): SyncedGroupRow[] {
  const db = getDb();
  const trackingCutoff = new Date(
    Date.now() - trackingMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const lapsedCutoff = new Date(
    Date.now() - lapsedWeeks * 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const excludedGroupTypes = getExcludedGroupTypes(orgId);
  const excludeFilter =
    excludedGroupTypes.length === 0
      ? ""
      : ` AND (g.group_type_id IS NULL OR g.group_type_id NOT IN (${excludedGroupTypes
          .map(() => "?")
          .join(",")}))`;

  // "members"  = active PCO membership (archived_at IS NULL). Matches the
  //   PCO roster headcount. We do NOT cut lapsed people from this number —
  //   they're still on the roster — but they DO show up in `leftRecently`
  //   so the lead pastor can see at-a-glance who's drifted.
  // "leaders"  = subset of members whose role contains "leader".
  // "leftRecently" UNIONS three paths: archived in window, attended-then-
  //   disappeared (only flag people not currently on the roster), and
  //   currently-lapsed members whose lapse falls inside the tracking window
  //   AND for whom we have evidence-of-absence (attendance was actually
  //   taken in the lapsed window — no attendance taken means we can't
  //   confidently say they stopped showing up).
  // "attendancePct" = distinct attendees-still-on-roster / members × 100,
  //   bounded ≤ 100%.
  // "eventsWithAttendance" = events with at LEAST one attended=1 row.
  //   Events where everyone is marked absent are treated as canceled.
  //
  // Pre-aggregate per group_id in CTEs to avoid 9 correlated subqueries
  // × N groups (was ~1000 subquery executions for ~110 groups; now 5
  // sequential scans of indexes).
  const rows = db
    .prepare(
      `WITH attended_roster_lookup AS (
         -- Per (group_id, person_id), does this person have an active
         -- membership? Used to scope "attended distinct" to current roster
         -- and to detect "attended-then-disappeared".
         SELECT group_id, person_id, 1 AS active
           FROM pco_group_memberships
          WHERE org_id = ?
            AND archived_at IS NULL
       ),
       members_per_group AS (
         SELECT m.group_id,
                SUM(CASE WHEN m.archived_at IS NULL THEN 1 ELSE 0 END) AS members,
                SUM(CASE WHEN m.archived_at IS NULL
                          AND lower(coalesce(m.role, '')) LIKE '%leader%'
                         THEN 1 ELSE 0 END) AS leaders,
                SUM(CASE WHEN m.archived_at IS NULL
                          AND m.joined_at IS NOT NULL
                          AND m.joined_at >= ?
                         THEN 1 ELSE 0 END) AS joinedRecently,
                SUM(CASE WHEN m.archived_at IS NOT NULL
                          AND m.archived_at >= ?
                         THEN 1 ELSE 0 END) AS archivedInWindow,
                COUNT(DISTINCT CASE
                  WHEN m.archived_at IS NULL
                    AND m.last_attended_at IS NOT NULL
                    AND m.last_attended_at >= ?
                    AND m.last_attended_at < ?
                  THEN m.person_id END) AS lapsedCandidates
           FROM pco_group_memberships m
          WHERE m.org_id = ?
          GROUP BY m.group_id
       ),
       events_per_group AS (
         SELECT e.group_id,
                COUNT(*) AS recentEvents
           FROM pco_group_events e
          WHERE e.org_id = ?
            AND e.starts_at IS NOT NULL
            AND e.starts_at >= ?
          GROUP BY e.group_id
       ),
       attendance_per_group AS (
         SELECT a.group_id,
                COUNT(DISTINCT CASE
                  WHEN arl.active = 1
                  THEN a.person_id END) AS attendedDistinctRecently,
                COUNT(DISTINCT a.event_id) AS eventsWithAttendance,
                COUNT(DISTINCT CASE
                  WHEN arl.active IS NULL
                  THEN a.person_id END) AS attendedThenDisappeared,
                -- Was attendance taken in the LAPSED window? (used to gate
                -- the "lapsed" left-path: no taken-attendance → no evidence)
                MAX(CASE WHEN a.event_starts_at >= ? THEN 1 ELSE 0 END)
                  AS attendanceTakenInLapsedWindow
           FROM pco_event_attendances a
           LEFT JOIN attended_roster_lookup arl
             ON arl.group_id = a.group_id AND arl.person_id = a.person_id
          WHERE a.org_id = ?
            AND a.attended = 1
            AND a.event_starts_at IS NOT NULL
            AND a.event_starts_at >= ?
          GROUP BY a.group_id
       )
       SELECT
         g.pco_id            AS pcoId,
         g.name              AS name,
         g.schedule          AS schedule,
         gt.name             AS groupTypeName,
         g.pco_created_at    AS pcoCreatedAt,
         g.archived_at       AS archivedAt,
         COALESCE(mpg.members, 0)        AS members,
         COALESCE(mpg.leaders, 0)        AS leaders,
         COALESCE(mpg.joinedRecently, 0) AS joinedRecently,
         COALESCE(mpg.archivedInWindow, 0)
           + COALESCE(apg.attendedThenDisappeared, 0)
           + CASE WHEN COALESCE(apg.attendanceTakenInLapsedWindow, 0) = 1
                  THEN COALESCE(mpg.lapsedCandidates, 0)
                  ELSE 0 END AS leftRecently,
         COALESCE(epg.recentEvents, 0)              AS recentEvents,
         COALESCE(apg.attendedDistinctRecently, 0)  AS attendedDistinctRecently,
         COALESCE(apg.eventsWithAttendance, 0)      AS eventsWithAttendance
       FROM pco_groups g
       LEFT JOIN pco_group_types gt
         ON gt.org_id = g.org_id AND gt.pco_id = g.group_type_id
       LEFT JOIN members_per_group   mpg ON mpg.group_id = g.pco_id
       LEFT JOIN events_per_group    epg ON epg.group_id = g.pco_id
       LEFT JOIN attendance_per_group apg ON apg.group_id = g.pco_id
       WHERE g.org_id = ?${excludeFilter}
       ORDER BY g.archived_at IS NULL DESC, members DESC, g.name ASC`,
    )
    .all(
      orgId,           // attended_roster_lookup org filter
      trackingCutoff,  // members CTE: joinedRecently
      trackingCutoff,  // members CTE: archivedInWindow
      trackingCutoff,  // members CTE: lapsed last_attended_at >=
      lapsedCutoff,    // members CTE: lapsed last_attended_at <
      orgId,           // members CTE org filter
      orgId,           // events CTE org
      trackingCutoff,  // events CTE: recent events
      lapsedCutoff,    // attendance CTE: attendance-taken-in-lapsed-window flag
      orgId,           // attendance CTE org
      trackingCutoff,  // attendance CTE: in window
      orgId,           // outer where
      ...excludedGroupTypes,
    ) as Array<{
    pcoId: string;
    name: string | null;
    schedule: string | null;
    groupTypeName: string | null;
    pcoCreatedAt: string | null;
    archivedAt: string | null;
    members: number;
    leaders: number;
    joinedRecently: number;
    leftRecently: number;
    recentEvents: number;
    attendedDistinctRecently: number;
    eventsWithAttendance: number;
  }>;

  return rows.map((r) => {
    let state: SyncedGroupRow["state"];
    if (r.archivedAt) state = "paused";
    else if (r.recentEvents === 0 && r.members > 0) state = "paused";
    else {
      const net = r.joinedRecently - r.leftRecently;
      if (net >= 2) state = "growing";
      else if (net <= -2) state = "shrinking";
      else state = "steady";
    }
    // % of events that had attendance actually recorded. NULL if there
    // were no events in the window.
    const attendanceTakenPct =
      r.recentEvents > 0
        ? (r.eventsWithAttendance / r.recentEvents) * 100
        : null;
    // % of members who attended ≥ once in the window. Only meaningful
    // when attendance was actually taken — otherwise NULL, not 0%.
    // The SQL already constrains attendees to current roster members,
    // so the ratio is bounded ≤ 100%; the Math.min is belt-and-suspenders.
    const attendancePct =
      r.eventsWithAttendance > 0 && r.members > 0
        ? Math.min(100, (r.attendedDistinctRecently / r.members) * 100)
        : null;
    return {
      pcoId: r.pcoId,
      name: r.name,
      schedule: r.schedule,
      groupTypeName: r.groupTypeName,
      pcoCreatedAt: r.pcoCreatedAt,
      archivedAt: r.archivedAt,
      members: r.members,
      leaders: r.leaders,
      joinedRecently: r.joinedRecently,
      leftRecently: r.leftRecently,
      recentEvents: r.recentEvents,
      attendanceTakenPct,
      attendancePct,
      state,
    };
  });
}

export interface GroupTotals {
  totalGroups: number;
  activeGroups: number;
  growing: number;
  steady: number;
  shrinking: number;
  paused: number;
  totalMembers: number;
  totalLeaders: number;
  joinedRecently: number;
  leftRecently: number;
}

export function getGroupTotals(
  orgId: number,
  trackingMonths: number,
  lapsedWeeks: number,
): GroupTotals {
  const groups = listGroups(orgId, trackingMonths, lapsedWeeks);
  const totals: GroupTotals = {
    totalGroups: groups.length,
    activeGroups: groups.filter((g) => !g.archivedAt).length,
    growing: 0,
    steady: 0,
    shrinking: 0,
    paused: 0,
    totalMembers: 0,
    totalLeaders: 0,
    joinedRecently: 0,
    leftRecently: 0,
  };
  for (const g of groups) {
    totals.joinedRecently += g.joinedRecently;
    totals.leftRecently += g.leftRecently;
    if (g.archivedAt) continue;
    totals.totalMembers += g.members;
    totals.totalLeaders += g.leaders;
    totals[g.state]++;
  }
  return totals;
}

export function listCommunityPeople(
  orgId: number,
  limit = 100,
): CommunityPersonRow[] {
  const db = getDb();
  const excludedGroupTypes = getExcludedGroupTypes(orgId);
  const { join, args: joinArgs } = nonExcludedJoin(excludedGroupTypes);

  // No person-level membership_type filter here — being in a group is what
  // qualifies someone for the Community lane (member or leader).
  const rows = db
    .prepare(
      `SELECT
         p.pco_id AS pcoId,
         p.enc_pii AS encPii,
         p.membership_type AS membershipType,
         COUNT(DISTINCT m.group_id) AS groupCount,
         MIN(m.joined_at) AS joinedFirstAt
       FROM pco_group_memberships m
       ${join}
       JOIN pco_people p ON p.org_id = m.org_id AND p.pco_id = m.person_id
       WHERE m.org_id = ?
         AND m.archived_at IS NULL
       GROUP BY p.pco_id, p.enc_pii, p.membership_type
       ORDER BY COUNT(DISTINCT m.group_id) DESC, MIN(m.joined_at) DESC NULLS LAST
       LIMIT ?`,
    )
    .all(...joinArgs, orgId, limit) as {
    pcoId: string;
    encPii: string | null;
    membershipType: string | null;
    groupCount: number;
    joinedFirstAt: string | null;
  }[];

  return rows.map((r) => {
    const pii = decryptJson<PIIBlob>(r.encPii) ?? {};
    const firstName = pii.first_name ?? null;
    const lastName = pii.last_name ?? null;
    const fullName =
      [firstName, lastName].filter(Boolean).join(" ") || `(unknown #${r.pcoId})`;
    const initials =
      ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "??";
    return {
      pcoId: r.pcoId,
      fullName,
      initials,
      membershipType: r.membershipType,
      groupCount: r.groupCount,
      joinedFirstAt: r.joinedFirstAt,
    };
  });
}
