import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

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
  activityMonths: number,
): DashboardStats {
  const db = getDb();
  const cutoff30 = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
  const cutoffActivity = new Date(
    Date.now() - activityMonths * MS_PER_MONTH,
  ).toISOString();

  // Active = anyone with a form sub, group attendance, plan serve, or
  // PCO record update in the activity window. Mirrors the looser
  // people-read definition rather than the stricter classification
  // bucket so the headline doesn't look artificially small.
  const active = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT pco_id) AS n
           FROM pco_people
          WHERE org_id = ?
            AND (
              last_form_submission_at >= ?
              OR pco_updated_at >= ?
              OR pco_id IN (
                SELECT DISTINCT person_id FROM pco_event_attendances
                 WHERE org_id = ? AND attended = 1 AND event_starts_at >= ?
              )
              OR pco_id IN (
                SELECT DISTINCT pp.person_id FROM pco_plan_people pp
                  JOIN pco_plans p
                    ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
                 WHERE pp.org_id = ?
                   AND pp.person_id != ''
                   AND p.sort_date >= ?
                   AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
              )
            )`,
      )
      .get(
        orgId,
        cutoffActivity,
        cutoffActivity,
        orgId,
        cutoffActivity,
        orgId,
        cutoffActivity,
      ) as { n: number } | undefined
  )?.n ?? 0;

  // Joined this month = distinct person ids with a new (group joined_at
  // OR team pco_created_at) inside the last 30 days.
  const joinedRow = db
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
    .get(orgId, cutoff30, orgId, cutoff30) as { n: number } | undefined;
  // Detect "we have no data at all" so we render NULL → "insufficient",
  // not a deceptively confident 0.
  const haveJoinData = (
    db
      .prepare(
        `SELECT EXISTS(
           SELECT 1 FROM pco_group_memberships WHERE org_id = ? AND joined_at IS NOT NULL
         ) OR EXISTS(
           SELECT 1 FROM pco_team_memberships WHERE org_id = ? AND pco_created_at IS NOT NULL
         ) AS yes`,
      )
      .get(orgId, orgId) as { yes: number } | undefined
  )?.yes === 1;

  // Departed = distinct person ids with archived_at inside last 30d
  // (group or team).
  const departedRow = db
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
    .get(orgId, cutoff30, orgId, cutoff30) as { n: number } | undefined;

  // Unshepherded = people who have NO active membership in any group
  // AND NO active membership on any team. We use the same membership
  // definitions as the /shepherds page so the numbers tie out.
  const unshepherded = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM pco_people p
          WHERE p.org_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM pco_group_memberships m
               WHERE m.org_id = p.org_id
                 AND m.person_id = p.pco_id
                 AND m.archived_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM pco_team_memberships tm
               WHERE tm.org_id = p.org_id
                 AND tm.person_id = p.pco_id
                 AND tm.archived_at IS NULL
            )`,
      )
      .get(orgId) as { n: number } | undefined
  )?.n ?? 0;

  const now = new Date();
  const monthLabel = `${now.toLocaleString("en-US", {
    month: "short",
  })} ${now.getFullYear()}`;

  return {
    active,
    joinedMonth: haveJoinData ? (joinedRow?.n ?? 0) : null,
    departedMonth: haveJoinData ? (departedRow?.n ?? 0) : null,
    unshepherded,
    nextStepReady: null,
    monthLabel,
  };
}

// ─── Falling through the cracks ──────────────────────────────────

export interface FallingPerson {
  personId: string;
  fullName: string;
  /** Last activity date (any source). NULL when we've never seen
   *  activity. */
  lastActivityAt: string | null;
  /** Free-form context like "Active Sundays · last seen Mar 2025". */
  context: string;
  /** Days since last activity, used for sorting + the "risk" tone. */
  daysSilent: number | null;
}

/** People classified as inactive (no measurable activity in the last
 *  `activityMonths` window) — pulled directly from the classification
 *  rule used everywhere else, so the count here matches the Metrics
 *  page. Sorted by longest silence first since those are the highest-
 *  priority follow-ups. */
export function getFallingThroughCracks(
  orgId: number,
  activityMonths: number,
  limit: number = 6,
): FallingPerson[] {
  const db = getDb();
  const cutoffActivity = new Date(
    Date.now() - activityMonths * MS_PER_MONTH,
  ).toISOString();
  const rows = db
    .prepare(
      `WITH last_act AS (
         SELECT pco_id,
                MAX(coalesce(last_form_submission_at, '')) AS last_form,
                MAX(coalesce(pco_updated_at, '')) AS last_updated
           FROM pco_people
          WHERE org_id = ?
          GROUP BY pco_id
       ),
       last_att AS (
         SELECT person_id, MAX(event_starts_at) AS last_att_at
           FROM pco_event_attendances
          WHERE org_id = ? AND attended = 1
          GROUP BY person_id
       ),
       last_serve AS (
         SELECT pp.person_id, MAX(p.sort_date) AS last_serve_at
           FROM pco_plan_people pp
           JOIN pco_plans p
             ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
          WHERE pp.org_id = ?
            AND pp.person_id != ''
            AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
          GROUP BY pp.person_id
       )
       SELECT p.pco_id AS personId,
              p.enc_pii AS encPii,
              p.pco_created_at AS createdAt,
              max(
                coalesce(la.last_form, ''),
                coalesce(la.last_updated, ''),
                coalesce(att.last_att_at, ''),
                coalesce(srv.last_serve_at, '')
              ) AS lastActivityAt
         FROM pco_people p
         LEFT JOIN last_act la ON la.pco_id = p.pco_id
         LEFT JOIN last_att att ON att.person_id = p.pco_id
         LEFT JOIN last_serve srv ON srv.person_id = p.pco_id
        WHERE p.org_id = ?
          AND p.pco_created_at IS NOT NULL
          AND p.pco_created_at < ?
        ORDER BY lastActivityAt ASC NULLS FIRST
        LIMIT ?`,
    )
    .all(
      orgId,
      orgId,
      orgId,
      orgId,
      cutoffActivity,
      limit * 4, // overscan because filter below trims many
    ) as Array<{
    personId: string;
    encPii: string | null;
    createdAt: string;
    lastActivityAt: string | null;
  }>;

  const now = Date.now();
  const out: FallingPerson[] = [];
  for (const r of rows) {
    const lastIso = r.lastActivityAt && r.lastActivityAt !== ""
      ? r.lastActivityAt
      : null;
    // Keep only people who haven't had activity inside the window.
    if (lastIso && lastIso >= cutoffActivity) continue;
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const name =
      [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") ||
      `(unknown #${r.personId})`;
    const daysSilent = lastIso
      ? Math.floor((now - new Date(lastIso).getTime()) / MS_PER_DAY)
      : null;
    out.push({
      personId: r.personId,
      fullName: name,
      lastActivityAt: lastIso,
      daysSilent,
      context: lastIso
        ? `Last activity ${new Date(lastIso).toLocaleDateString()}`
        : "Never had measurable activity",
    });
    if (out.length >= limit) break;
  }
  return out;
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
  const rows = db
    .prepare(
      `WITH leaders AS (
         SELECT m.person_id, m.group_id AS unit_id, 'group' AS kind
           FROM pco_group_memberships m
           JOIN pco_groups g
             ON g.org_id = m.org_id AND g.pco_id = m.group_id
          WHERE m.org_id = ? AND m.archived_at IS NULL
            AND g.archived_at IS NULL
            AND lower(coalesce(m.role,'')) LIKE '%leader%'
         UNION ALL
         SELECT tm.person_id, tm.team_id AS unit_id, 'team' AS kind
           FROM pco_team_memberships tm
           JOIN pco_teams t
             ON t.org_id = tm.org_id AND t.pco_id = tm.team_id
          WHERE tm.org_id = ? AND tm.person_id != ''
            AND tm.is_team_leader = 1
            AND tm.archived_at IS NULL
            AND t.archived_at IS NULL AND t.deleted_at IS NULL
       ),
       leader_groups AS (
         SELECT person_id, COUNT(DISTINCT unit_id) AS n
           FROM leaders GROUP BY person_id
       ),
       flock AS (
         SELECT l.person_id,
                COUNT(DISTINCT
                  CASE WHEN l.kind = 'group' THEN 'g:' || m.person_id
                       WHEN l.kind = 'team'  THEN 't:' || tm.person_id
                  END
                ) AS reach
           FROM leaders l
           LEFT JOIN pco_group_memberships m
             ON l.kind = 'group'
            AND m.org_id = ?
            AND m.group_id = l.unit_id
            AND m.archived_at IS NULL
            AND m.person_id != l.person_id
           LEFT JOIN pco_team_memberships tm
             ON l.kind = 'team'
            AND tm.org_id = ?
            AND tm.team_id = l.unit_id
            AND tm.archived_at IS NULL
            AND tm.person_id != ''
            AND tm.person_id != l.person_id
          GROUP BY l.person_id
       )
       SELECT lg.person_id AS personId,
              lg.n AS unitsLed,
              coalesce(f.reach, 0) AS flockSize
         FROM leader_groups lg
         LEFT JOIN flock f ON f.person_id = lg.person_id
        ORDER BY flockSize DESC, lg.n DESC
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
 *  group event in the activity window OR appear in any active team
 *  roster (a rough "in the building" proxy). Community = active group
 *  members. Serve = active team members. Give + Outreach are NULL —
 *  we don't sync donations or outreach activity yet. None = total
 *  people with NO activity in the window (the inactive bucket). */
export function getLaneStats(
  orgId: number,
  activityMonths: number,
): LaneStat[] {
  const db = getDb();
  const cutoff = new Date(
    Date.now() - activityMonths * MS_PER_MONTH,
  ).toISOString();

  // Worship — anyone with a group attendance OR an attended plan in
  // the window. Best proxy we have without check-in sync.
  const wors = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT person_id FROM pco_event_attendances
            WHERE org_id = ? AND attended = 1 AND event_starts_at >= ?
           UNION
           SELECT DISTINCT pp.person_id FROM pco_plan_people pp
             JOIN pco_plans p
               ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
            WHERE pp.org_id = ?
              AND pp.person_id != ''
              AND p.sort_date >= ?
              AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
         )`,
      )
      .get(orgId, cutoff, orgId, cutoff) as { n: number } | undefined
  )?.n ?? 0;

  const comm = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT person_id) AS n
           FROM pco_group_memberships
          WHERE org_id = ? AND archived_at IS NULL`,
      )
      .get(orgId) as { n: number } | undefined
  )?.n ?? 0;

  const serv = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT person_id) AS n
           FROM pco_team_memberships
          WHERE org_id = ? AND person_id != '' AND archived_at IS NULL`,
      )
      .get(orgId) as { n: number } | undefined
  )?.n ?? 0;

  // None = people who DON'T appear in any of the three lane sets above.
  const none = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM pco_people p
          WHERE p.org_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM pco_event_attendances a
               WHERE a.org_id = p.org_id AND a.person_id = p.pco_id
                 AND a.attended = 1 AND a.event_starts_at >= ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM pco_plan_people pp
                JOIN pco_plans pl
                  ON pl.org_id = pp.org_id AND pl.pco_id = pp.plan_id
               WHERE pp.org_id = p.org_id AND pp.person_id = p.pco_id
                 AND pl.sort_date >= ?
                 AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
            )
            AND NOT EXISTS (
              SELECT 1 FROM pco_group_memberships m
               WHERE m.org_id = p.org_id AND m.person_id = p.pco_id
                 AND m.archived_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM pco_team_memberships tm
               WHERE tm.org_id = p.org_id AND tm.person_id = p.pco_id
                 AND tm.archived_at IS NULL
            )`,
      )
      .get(orgId, cutoff, cutoff) as { n: number } | undefined
  )?.n ?? 0;

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
