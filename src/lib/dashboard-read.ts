import "server-only";
import { getDb } from "./db";
import { getOrgSnapshot } from "./dashboard-refresh";
import { decryptJson } from "./encryption";
import { getSyncSettings } from "./pco";

const MS_PER_DAY = 86_400_000;
const MS_PER_MONTH = 30 * MS_PER_DAY;

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

// ─── Top stat strip (home page) ──────────────────────────────────

export interface DashboardStats {
  active: number;
  /** Distinct people who joined any group OR were added to any team in
   *  the last 30 days. NULL when we have no membership data yet. */
  joinedMonth: number | null;
  /** Distinct people who left any group OR team in the last 30 days
   *  (archived_at within window). NULL when we have no data. */
  departedMonth: number | null;
  /** People not on any active group / team / care roster. */
  unshepherded: number;
  /** Always null — no automated next-step classifier yet. UI shows
   *  "—" with an "Insufficient data" tooltip. */
  nextStepReady: number | null;
  /** Calendar label like "Aug 2026" used in the joined/departed
   *  delta sublabels. */
  monthLabel: string;
}

export function getDashboardStats(
  orgId: number,
  _activityMonths: number,
): DashboardStats {
  const now = new Date();
  const monthLabel = `${now.toLocaleString("en-US", {
    month: "short",
  })} ${now.getFullYear()}`;

  // Snapshot fast path — one indexed row read replaces the previous
  // 4-CTE / multiple-NOT-EXISTS scan over pco_people.
  const snap = getOrgSnapshot(orgId);
  if (snap) {
    // Detect "we have no joined-at history at all" so we still show
    // an honest "—" instead of a confident 0.
    const haveJoinData = hasMembershipTimestamps(orgId);
    return {
      active: snap.activeCount + snap.shepherdedCount + snap.presentCount,
      joinedMonth: haveJoinData ? snap.joined30d : null,
      departedMonth: haveJoinData ? snap.departed30d : null,
      unshepherded: snap.unshepherdedCount,
      nextStepReady: null,
      monthLabel,
    };
  }

  // Cold-start fallback — no snapshot yet (fresh install, or refresh
  // hasn't run). Return zeros so the page still renders quickly
  // instead of hanging. The first sync after install populates the
  // snapshot and subsequent loads use the fast path.
  return {
    active: 0,
    joinedMonth: null,
    departedMonth: null,
    unshepherded: 0,
    nextStepReady: null,
    monthLabel,
  };
}

function hasMembershipTimestamps(orgId: number): boolean {
  const db = getDb();
  return (
    (
      db
        .prepare(
          `SELECT EXISTS(
             SELECT 1 FROM pco_group_memberships
              WHERE org_id = ? AND joined_at IS NOT NULL
           ) OR EXISTS(
             SELECT 1 FROM pco_team_memberships
              WHERE org_id = ? AND pco_created_at IS NOT NULL
           ) AS yes`,
        )
        .get(orgId, orgId) as { yes: number } | undefined
    )?.yes === 1
  );
}

// ─── Falling through the cracks ──────────────────────────────────

export interface FallingPerson {
  personId: string;
  fullName: string;
  /** Last attended or served date — whichever is more recent and
   *  applies to a roster the person is still on. */
  lastTouchAt: string | null;
  /** Free-form context — "Group: last attended Apr 2025" etc. */
  context: string;
  /** Days since last touch, used for sorting + the "risk" tone. */
  daysSilent: number | null;
}

/** People who are STILL on a group or team roster but haven't
 *  attended / served within the org's lapsed thresholds. Reads:
 *
 *    Group lapsed = active group membership AND last attendance
 *                   is older than `lapsedWeeks` weeks.
 *    Team lapsed  = active team membership AND last serve is
 *                   older than `lapsedFromTeamMonths` months.
 *
 *  This is the actually-pastoral signal — a fully-inactive person
 *  who's been off the radar for two years isn't who you can
 *  intervene with this week; someone who joined the men's group
 *  in February and went quiet in April is. Sorted by longest
 *  silence first so the most-overdue follow-ups bubble to the top. */
export function getFallingThroughCracks(
  orgId: number,
  limit: number = 6,
): FallingPerson[] {
  const db = getDb();
  const settings = getSyncSettings(orgId);
  const now = Date.now();
  const lapsedGroupCutoff = new Date(
    now - settings.lapsedWeeks * 7 * MS_PER_DAY,
  ).toISOString();
  const lapsedTeamCutoff = new Date(
    now - settings.lapsedFromTeamMonths * MS_PER_MONTH,
  ).toISOString();

  // Snapshot fast path — person_activity carries last_attended_at +
  // last_served_at + active counts pre-computed.
  const rows = db
    .prepare(
      `SELECT pa.person_id AS personId,
              pa.last_attended_at AS lastAttendedAt,
              pa.last_served_at  AS lastServedAt,
              pa.active_group_count AS groupCount,
              pa.active_team_count  AS teamCount,
              pp.enc_pii AS encPii
         FROM person_activity pa
         LEFT JOIN pco_people pp
           ON pp.org_id = pa.org_id AND pp.pco_id = pa.person_id
        WHERE pa.org_id = ?
          AND (
            (pa.active_group_count > 0
             AND pa.last_attended_at IS NOT NULL
             AND pa.last_attended_at < ?)
            OR
            (pa.active_team_count > 0
             AND pa.last_served_at IS NOT NULL
             AND pa.last_served_at < ?)
          )
        ORDER BY COALESCE(
          MIN(
            COALESCE(pa.last_attended_at, '9999'),
            COALESCE(pa.last_served_at, '9999')
          ),
          '0'
        ) ASC
        LIMIT ?`,
    )
    .all(orgId, lapsedGroupCutoff, lapsedTeamCutoff, limit) as Array<{
    personId: string;
    lastAttendedAt: string | null;
    lastServedAt: string | null;
    groupCount: number;
    teamCount: number;
    encPii: string | null;
  }>;

  return rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const name =
      [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") ||
      `(unknown #${r.personId})`;
    // Use the OLDER of the two lapsed signals — that's the one
    // dragging them down. If only one lane is lapsed (e.g. they're
    // serving fine but stopped attending group), use that one.
    const groupLapsed =
      r.groupCount > 0 &&
      r.lastAttendedAt !== null &&
      r.lastAttendedAt < lapsedGroupCutoff;
    const teamLapsed =
      r.teamCount > 0 &&
      r.lastServedAt !== null &&
      r.lastServedAt < lapsedTeamCutoff;
    let lastTouchAt: string | null = null;
    let context = "";
    if (groupLapsed && teamLapsed) {
      lastTouchAt =
        r.lastAttendedAt! < r.lastServedAt!
          ? r.lastAttendedAt
          : r.lastServedAt;
      context = `Group + team both lapsed · last touch ${new Date(lastTouchAt!).toLocaleDateString()}`;
    } else if (groupLapsed) {
      lastTouchAt = r.lastAttendedAt;
      context = `Group lapsed · last attended ${new Date(r.lastAttendedAt!).toLocaleDateString()}`;
    } else if (teamLapsed) {
      lastTouchAt = r.lastServedAt;
      context = `Team lapsed · last served ${new Date(r.lastServedAt!).toLocaleDateString()}`;
    }
    const daysSilent = lastTouchAt
      ? Math.floor((now - new Date(lastTouchAt).getTime()) / MS_PER_DAY)
      : null;
    return {
      personId: r.personId,
      fullName: name,
      lastTouchAt,
      daysSilent,
      context,
    };
  });
}

// ─── Recent movement (joined / left this week or month) ──────────

export interface MovementEvent {
  /** ISO date. */
  at: string;
  /** "Joined Tuesday Bible Study" / "Left Worship Team". */
  text: string;
  /** Day-of-week label for the leftmost column. */
  day: string;
  /** Slug for click-through. */
  personId: string;
  personName: string;
}

/** Latest joined/left across groups + teams. Pulled from joined_at /
 *  archived_at / pco_created_at — so the same surface area that drives
 *  the dashboard stats. */
export function getRecentMovement(
  orgId: number,
  days: number = 14,
  limit: number = 10,
): MovementEvent[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  const rows = db
    .prepare(
      `SELECT person_id, name, at, kind FROM (
         SELECT m.person_id AS person_id,
                g.name      AS name,
                m.joined_at AS at,
                'joined-group' AS kind
           FROM pco_group_memberships m
           LEFT JOIN pco_groups g
             ON g.org_id = m.org_id AND g.pco_id = m.group_id
          WHERE m.org_id = ? AND m.joined_at IS NOT NULL AND m.joined_at >= ?
         UNION ALL
         SELECT m.person_id, g.name, m.archived_at, 'left-group'
           FROM pco_group_memberships m
           LEFT JOIN pco_groups g
             ON g.org_id = m.org_id AND g.pco_id = m.group_id
          WHERE m.org_id = ? AND m.archived_at IS NOT NULL AND m.archived_at >= ?
         UNION ALL
         SELECT tm.person_id, t.name, tm.pco_created_at, 'added-team'
           FROM pco_team_memberships tm
           LEFT JOIN pco_teams t
             ON t.org_id = tm.org_id AND t.pco_id = tm.team_id
          WHERE tm.org_id = ? AND tm.person_id != ''
            AND tm.pco_created_at IS NOT NULL AND tm.pco_created_at >= ?
         UNION ALL
         SELECT tm.person_id, t.name, tm.archived_at, 'left-team'
           FROM pco_team_memberships tm
           LEFT JOIN pco_teams t
             ON t.org_id = tm.org_id AND t.pco_id = tm.team_id
          WHERE tm.org_id = ? AND tm.person_id != ''
            AND tm.archived_at IS NOT NULL AND tm.archived_at >= ?
       )
       ORDER BY at DESC
       LIMIT ?`,
    )
    .all(
      orgId, cutoff,
      orgId, cutoff,
      orgId, cutoff,
      orgId, cutoff,
      limit,
    ) as Array<{
    person_id: string;
    name: string | null;
    at: string;
    kind: string;
  }>;
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.person_id))];
  const placeholders = ids.map(() => "?").join(",");
  const peopleRows = db
    .prepare(
      `SELECT pco_id, enc_pii FROM pco_people
        WHERE org_id = ? AND pco_id IN (${placeholders})`,
    )
    .all(orgId, ...ids) as Array<{ pco_id: string; enc_pii: string | null }>;
  const nameById = new Map<string, string>();
  for (const r of peopleRows) {
    const pii = r.enc_pii ? decryptJson<PIIBlob>(r.enc_pii) : null;
    nameById.set(
      r.pco_id,
      [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") ||
        `(unknown #${r.pco_id})`,
    );
  }
  return rows.map((r) => {
    const verb =
      r.kind === "joined-group"
        ? `joined ${r.name ?? "a group"}`
        : r.kind === "left-group"
          ? `left ${r.name ?? "a group"}`
          : r.kind === "added-team"
            ? `added to ${r.name ?? "a team"}`
            : `left ${r.name ?? "a team"}`;
    const personName = nameById.get(r.person_id) ?? `(unknown)`;
    return {
      at: r.at,
      day: new Date(r.at).toLocaleDateString(undefined, {
        weekday: "short",
      }),
      personId: r.person_id,
      personName,
      text: `${personName} ${verb}`,
    };
  });
}

// ─── Shepherd workload (top by flock size) ───────────────────────

export interface ShepherdWorkload {
  personId: string;
  fullName: string;
  /** Distinct people across all groups + teams they lead. */
  flockSize: number;
  /** Count of led groups + teams. */
  unitsLed: number;
}

export function getShepherdWorkload(
  orgId: number,
  limit: number = 5,
): ShepherdWorkload[] {
  const db = getDb();
  // Compute group-side and team-side reach separately, then UNION at
  // the person level. This avoids the previous single-query approach
  // that did a kind-conditional LEFT JOIN to BOTH pco_group_memberships
  // and pco_team_memberships per leader row — that produced an
  // O(leaders × group_members + leaders × team_members) cartesian and
  // dominated home-page load time on real data.
  const rows = db
    .prepare(
      `WITH group_leaders AS (
         SELECT DISTINCT m.person_id, m.group_id AS unit_id
           FROM pco_group_memberships m
           JOIN pco_groups g
             ON g.org_id = m.org_id AND g.pco_id = m.group_id
          WHERE m.org_id = ? AND m.archived_at IS NULL
            AND g.archived_at IS NULL
            AND lower(coalesce(m.role,'')) LIKE '%leader%'
       ),
       team_leaders AS (
         SELECT DISTINCT tm.person_id, tm.team_id AS unit_id
           FROM pco_team_memberships tm
           JOIN pco_teams t
             ON t.org_id = tm.org_id AND t.pco_id = tm.team_id
          WHERE tm.org_id = ? AND tm.person_id != ''
            AND tm.is_team_leader = 1
            AND tm.archived_at IS NULL
            AND t.archived_at IS NULL AND t.deleted_at IS NULL
       ),
       group_reach AS (
         SELECT gl.person_id, gl.unit_id, m.person_id AS reached_id
           FROM group_leaders gl
           JOIN pco_group_memberships m
             ON m.org_id = ? AND m.group_id = gl.unit_id
            AND m.archived_at IS NULL
            AND m.person_id != gl.person_id
       ),
       team_reach AS (
         SELECT tl.person_id, tl.unit_id, tm.person_id AS reached_id
           FROM team_leaders tl
           JOIN pco_team_memberships tm
             ON tm.org_id = ? AND tm.team_id = tl.unit_id
            AND tm.archived_at IS NULL AND tm.person_id != ''
            AND tm.person_id != tl.person_id
       ),
       all_reach AS (
         SELECT person_id, reached_id FROM group_reach
         UNION
         SELECT person_id, reached_id FROM team_reach
       ),
       all_leaders AS (
         SELECT person_id, unit_id FROM group_leaders
         UNION
         SELECT person_id, unit_id FROM team_leaders
       )
       SELECT al.person_id AS personId,
              COUNT(DISTINCT al.unit_id) AS unitsLed,
              (SELECT COUNT(DISTINCT reached_id) FROM all_reach ar
                WHERE ar.person_id = al.person_id) AS flockSize
         FROM all_leaders al
        GROUP BY al.person_id
        ORDER BY flockSize DESC, unitsLed DESC
        LIMIT ?`,
    )
    .all(orgId, orgId, orgId, orgId, limit) as Array<{
    personId: string;
    unitsLed: number;
    flockSize: number;
  }>;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.personId);
  const placeholders = ids.map(() => "?").join(",");
  const peopleRows = db
    .prepare(
      `SELECT pco_id, enc_pii FROM pco_people
        WHERE org_id = ? AND pco_id IN (${placeholders})`,
    )
    .all(orgId, ...ids) as Array<{ pco_id: string; enc_pii: string | null }>;
  const nameById = new Map<string, string>();
  for (const r of peopleRows) {
    const pii = r.enc_pii ? decryptJson<PIIBlob>(r.enc_pii) : null;
    nameById.set(
      r.pco_id,
      [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") ||
        `(unknown)`,
    );
  }
  return rows.map((r) => ({
    personId: r.personId,
    fullName: nameById.get(r.personId) ?? `(unknown)`,
    flockSize: r.flockSize,
    unitsLed: r.unitsLed,
  }));
}

// ─── Lane stat cards (for /lanes) ────────────────────────────────

export interface LaneStat {
  key: "wors" | "comm" | "serv" | "give" | "outr" | "none";
  label: string;
  count: number | null;
  /** True when we currently can't measure this lane at all (no data
   *  source wired yet). UI greys those out and shows the reason. */
  unavailable?: boolean;
  reason?: string;
}

/** Per-lane headcounts. Worship = distinct people who attended any
 *  group event in the activity window OR served on a plan. Community
 *  = active group members. Serve = active team members. Give +
 *  Outreach are NULL — no source synced. None = total people with no
 *  trace of any of the above.
 *
 *  Implementation note: the previous version ran 4 NOT EXISTS
 *  subqueries against the full pco_people table to compute "none",
 *  which produced an O(people × 4) lookup pattern and made the page
 *  hang on real data. The fix builds the active-person id set once
 *  into an in-memory TEMP TABLE (with a primary key index) and joins
 *  against it — every lane count then resolves to a single indexed
 *  scan instead of millions of subquery executions. */
export function getLaneStats(
  orgId: number,
  _activityMonths: number,
): LaneStat[] {
  // Snapshot fast path — every count comes from a single indexed row
  // instead of scanning pco_people / pco_event_attendances on every
  // page render. The snapshot is refreshed after every sync.
  const snap = getOrgSnapshot(orgId);
  const wors = snap?.laneWors ?? 0;
  const comm = snap?.laneComm ?? 0;
  const serv = snap?.laneServ ?? 0;
  const none = snap?.laneNone ?? 0;

  return [
    { key: "wors", label: "Worship", count: wors },
    { key: "comm", label: "Community", count: comm },
    { key: "serv", label: "Serve", count: serv },
    {
      key: "give",
      label: "Giving",
      count: null,
      unavailable: true,
      reason: "PCO Giving isn't synced yet — once it is, this lane fills in.",
    },
    {
      key: "outr",
      label: "Outreach",
      count: null,
      unavailable: true,
      reason: "No outreach data source wired — manual tagging coming.",
    },
    { key: "none", label: "No activity", count: none },
  ];
}
