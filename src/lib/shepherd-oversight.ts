import "server-only";
import { getDb } from "./db";
import { type TargetKind } from "./assignments-types";
import { listAssignments } from "./assignments-read";
import { getListByName } from "./lists-read";
import { DEFAULT_BANDWIDTH, SHEPHERD_TEAM_LIST } from "./shepherd-assign";
import { getShepherdTeamBreakdown } from "./shepherd-team-read";

/** One shepherd's page: what they oversee, what it costs them, and the
 *  bandwidth they agreed to.
 *
 *  The team page answers "how is the load spread" for everyone at once.
 *  This answers "who does this one person oversee, and is that too much" —
 *  so it is deliberately a single-shepherd read: every query here is
 *  filtered to them, and nothing fans out across the roster.
 */

export interface Connection {
  /** shepherd_assignments.id — what the remove button posts. */
  id: number;
  kind: TargetKind;
  targetId: string;
  targetName: string;
  note: string | null;
  /** How many people this one connection brings. */
  reach: number;
  /** "every member", "13 groups, every member" — says what reach counted. */
  detail: string;
}

export interface AssignedPerson {
  personId: string;
  name: string;
  /** How they got here: bulk / contested / manual / auto. */
  source: string;
}

export interface Oversight {
  personId: string;
  name: string;
  initials: string;
  /** Distinct people reached through groups, teams and the connections
   *  below. Not the sum of the tiles — somebody in two of them counts once. */
  byRole: number;
  /** Never null: DEFAULT_BANDWIDTH when they have none of their own. */
  bandwidth: number;
  /** True when this is their own figure rather than the default. */
  bandwidthSet: boolean;
  connections: Connection[];
  /** People handed to them individually, newest first. */
  assignedPeople: AssignedPerson[];
}

const nameOf = (f: string | null, l: string | null, id: string) =>
  [f?.trim(), l?.trim()].filter(Boolean).join(" ") || `(unknown #${id})`;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "??";

export function getOversight(
  orgId: number,
  shepherdPersonId: string,
): Oversight | null {
  const db = getDb();

  const person = db
    .prepare(
      `SELECT first_name AS f, last_name AS l FROM pco_people
        WHERE org_id = ? AND pco_id = ?`,
    )
    .get(orgId, shepherdPersonId) as
    | { f: string | null; l: string | null }
    | undefined;
  if (!person) return null;

  const name = nameOf(person.f, person.l, shepherdPersonId);

  const mine = listAssignments(orgId).filter(
    (a) => a.shepherdPersonId === shepherdPersonId,
  );
  const reach = reachFor(orgId, mine);

  const assignedPeople = db
    .prepare(
      `SELECT a.person_id AS personId, a.source AS source,
              p.first_name AS f, p.last_name AS l
         FROM shepherd_person_assignments a
         JOIN pco_people p
           ON p.org_id = a.org_id AND p.pco_id = a.person_id
        WHERE a.org_id = ? AND a.shepherd_person_id = ?
        ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
    )
    .all(orgId, shepherdPersonId) as Array<{
    personId: string;
    source: string;
    f: string | null;
    l: string | null;
  }>;

  const ownBandwidth = db
    .prepare(
      `SELECT max_people AS n FROM shepherd_bandwidth
        WHERE org_id = ? AND shepherd_person_id = ?`,
    )
    .get(orgId, shepherdPersonId) as { n: number } | undefined;

  return {
    personId: shepherdPersonId,
    name,
    initials: initialsOf(name),
    byRole:
      getShepherdTeamBreakdown(orgId, [shepherdPersonId]).get(
        shepherdPersonId,
      )?.totalReach ?? 0,
    bandwidth: ownBandwidth?.n ?? DEFAULT_BANDWIDTH,
    bandwidthSet: ownBandwidth !== undefined,
    connections: mine.map((a) => ({
      id: a.id,
      kind: a.targetKind,
      targetId: a.targetId,
      targetName: a.targetName,
      note: a.note,
      reach: reach.get(`${a.targetKind}:${a.targetId}`)?.n ?? 0,
      detail: reach.get(`${a.targetKind}:${a.targetId}`)?.detail ?? "",
    })),
    assignedPeople: assignedPeople.map((r) => ({
      personId: r.personId,
      name: nameOf(r.f, r.l, r.personId),
      source: r.source,
    })),
  };
}

/** How many people every pickable group / group type / team / service type
 *  brings, keyed "kind:targetId" — so the picker can say what each option
 *  will cost BEFORE it is added, and total up a selection against the
 *  shepherd's bandwidth. Four org-wide GROUP BYs, not one query per option.
 */
export function optionReachCounts(orgId: number): Record<string, number> {
  const db = getDb();
  const out: Record<string, number> = {};

  const rows = (sql: string) =>
    db.prepare(sql).all(orgId) as Array<{ id: string; n: number }>;

  for (const r of rows(
    `SELECT m.group_id AS id, COUNT(DISTINCT m.person_id) AS n
       FROM pco_group_memberships m
       JOIN pco_groups g ON g.org_id = m.org_id AND g.pco_id = m.group_id
      WHERE m.org_id = ? AND m.archived_at IS NULL AND g.archived_at IS NULL
      GROUP BY m.group_id`,
  )) {
    out[`group:${r.id}`] = r.n;
  }
  for (const r of rows(
    `SELECT g.group_type_id AS id, COUNT(DISTINCT m.person_id) AS n
       FROM pco_groups g
  LEFT JOIN pco_group_memberships m
         ON m.org_id = g.org_id AND m.group_id = g.pco_id
        AND m.archived_at IS NULL
      WHERE g.org_id = ? AND g.archived_at IS NULL
        AND g.group_type_id IS NOT NULL
      GROUP BY g.group_type_id`,
  )) {
    out[`group_type:${r.id}`] = r.n;
  }
  for (const r of rows(
    `SELECT m.team_id AS id, COUNT(DISTINCT m.person_id) AS n
       FROM pco_team_memberships m
       JOIN pco_teams t ON t.org_id = m.org_id AND t.pco_id = m.team_id
      WHERE m.org_id = ? AND m.archived_at IS NULL AND m.person_id != ''
        AND t.archived_at IS NULL AND t.deleted_at IS NULL
      GROUP BY m.team_id`,
  )) {
    out[`team:${r.id}`] = r.n;
  }
  for (const r of rows(
    `SELECT t.service_type_id AS id, COUNT(DISTINCT m.person_id) AS n
       FROM pco_teams t
  LEFT JOIN pco_team_memberships m
         ON m.org_id = t.org_id AND m.team_id = t.pco_id
        AND m.archived_at IS NULL AND m.person_id != ''
      WHERE t.org_id = ? AND t.archived_at IS NULL AND t.deleted_at IS NULL
        AND t.service_type_id IS NOT NULL
      GROUP BY t.service_type_id`,
  )) {
    out[`service_type:${r.id}`] = r.n;
  }
  return out;
}

/** How many people each connection brings, keyed "kind:targetId".
 *
 *  This is per-connection on purpose: it answers "what does THIS tile
 *  cost", which is the question you ask before removing one. It is not a
 *  distinct count across connections, so the tiles can add up to more than
 *  the shepherd's load — somebody in two of their groups is one person but
 *  appears in both tiles. The page says so rather than hiding it.
 */
function reachFor(
  orgId: number,
  assignments: Array<{ targetKind: TargetKind; targetId: string }>,
): Map<string, { n: number; detail: string }> {
  const out = new Map<string, { n: number; detail: string }>();
  if (assignments.length === 0) return out;
  const db = getDb();

  const idsOf = (kind: TargetKind) => [
    ...new Set(
      assignments.filter((a) => a.targetKind === kind).map((a) => a.targetId),
    ),
  ];
  const set = (kind: TargetKind, id: string, n: number, detail: string) =>
    out.set(`${kind}:${id}`, { n, detail });
  const ph = (ids: string[]) => ids.map(() => "?").join(",");

  // ─── One specific group / team: its current roster ──────────────
  const groupIds = idsOf("group");
  if (groupIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT m.group_id AS id, COUNT(DISTINCT m.person_id) AS n
           FROM pco_group_memberships m
           JOIN pco_groups g
             ON g.org_id = m.org_id AND g.pco_id = m.group_id
          WHERE m.org_id = ? AND m.group_id IN (${ph(groupIds)})
            AND m.archived_at IS NULL AND g.archived_at IS NULL
          GROUP BY m.group_id`,
      )
      .all(orgId, ...groupIds) as Array<{ id: string; n: number }>;
    const byId = new Map(rows.map((r) => [r.id, r.n]));
    for (const id of groupIds)
      set("group", id, byId.get(id) ?? 0, "every member");
  }

  const teamIds = idsOf("team");
  if (teamIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT m.team_id AS id, COUNT(DISTINCT m.person_id) AS n
           FROM pco_team_memberships m
           JOIN pco_teams t
             ON t.org_id = m.org_id AND t.pco_id = m.team_id
          WHERE m.org_id = ? AND m.team_id IN (${ph(teamIds)})
            AND m.archived_at IS NULL AND m.person_id != ''
            AND t.archived_at IS NULL AND t.deleted_at IS NULL
          GROUP BY m.team_id`,
      )
      .all(orgId, ...teamIds) as Array<{ id: string; n: number }>;
    const byId = new Map(rows.map((r) => [r.id, r.n]));
    for (const id of teamIds)
      set("team", id, byId.get(id) ?? 0, "everyone on the roster");
  }

  // ─── A whole type: every unit under it, deduped across units ────
  const groupTypeIds = idsOf("group_type");
  if (groupTypeIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT g.group_type_id AS id,
                COUNT(DISTINCT m.person_id) AS n,
                COUNT(DISTINCT g.pco_id) AS units
           FROM pco_groups g
      LEFT JOIN pco_group_memberships m
             ON m.org_id = g.org_id AND m.group_id = g.pco_id
            AND m.archived_at IS NULL
          WHERE g.org_id = ? AND g.group_type_id IN (${ph(groupTypeIds)})
            AND g.archived_at IS NULL
          GROUP BY g.group_type_id`,
      )
      .all(orgId, ...groupTypeIds) as Array<{
      id: string;
      n: number;
      units: number;
    }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of groupTypeIds) {
      const r = byId.get(id);
      set(
        "group_type",
        id,
        r?.n ?? 0,
        `${(r?.units ?? 0).toLocaleString()} group${r?.units === 1 ? "" : "s"}, every member`,
      );
    }
  }

  const serviceTypeIds = idsOf("service_type");
  if (serviceTypeIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT t.service_type_id AS id,
                COUNT(DISTINCT m.person_id) AS n,
                COUNT(DISTINCT t.pco_id) AS units
           FROM pco_teams t
      LEFT JOIN pco_team_memberships m
             ON m.org_id = t.org_id AND m.team_id = t.pco_id
            AND m.archived_at IS NULL AND m.person_id != ''
          WHERE t.org_id = ? AND t.service_type_id IN (${ph(serviceTypeIds)})
            AND t.archived_at IS NULL AND t.deleted_at IS NULL
          GROUP BY t.service_type_id`,
      )
      .all(orgId, ...serviceTypeIds) as Array<{
      id: string;
      n: number;
      units: number;
    }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of serviceTypeIds) {
      const r = byId.get(id);
      set(
        "service_type",
        id,
        r?.n ?? 0,
        `${(r?.units ?? 0).toLocaleString()} team${r?.units === 1 ? "" : "s"}, every member`,
      );
    }
  }

  const positionIds = idsOf("team_position");
  if (positionIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT m.position_id AS id, COUNT(DISTINCT m.person_id) AS n
           FROM pco_team_memberships m
          WHERE m.org_id = ? AND m.position_id IN (${ph(positionIds)})
            AND m.archived_at IS NULL AND m.person_id != ''
          GROUP BY m.position_id`,
      )
      .all(orgId, ...positionIds) as Array<{ id: string; n: number }>;
    const byId = new Map(rows.map((r) => [r.id, r.n]));
    for (const id of positionIds)
      set("team_position", id, byId.get(id) ?? 0, "everyone in this position");
  }

  // ─── Membership type / reference list / peers ───────────────────
  const memTypes = idsOf("membership_type");
  if (memTypes.length > 0) {
    const rows = db
      .prepare(
        `SELECT membership_type AS id, COUNT(*) AS n FROM pco_people
          WHERE org_id = ? AND membership_type IN (${ph(memTypes)})
          GROUP BY membership_type`,
      )
      .all(orgId, ...memTypes) as Array<{ id: string; n: number }>;
    const byId = new Map(rows.map((r) => [r.id, r.n]));
    for (const id of memTypes)
      set("membership_type", id, byId.get(id) ?? 0, "everyone of this type");
  }

  const listIds = idsOf("reference_list");
  if (listIds.length > 0) {
    const rows = db
      .prepare(
        `SELECT list_id AS id, COUNT(DISTINCT person_id) AS n
           FROM pco_list_memberships
          WHERE org_id = ? AND list_id IN (${ph(listIds)})
          GROUP BY list_id`,
      )
      .all(orgId, ...listIds) as Array<{ id: string; n: number }>;
    const byId = new Map(rows.map((r) => [r.id, r.n]));
    for (const id of listIds)
      set("reference_list", id, byId.get(id) ?? 0, "everyone on the list");
  }

  for (const id of idsOf("person")) {
    set("person", id, 1, "another shepherd, one-to-one");
  }

  const shepherdTeam = idsOf("shepherd_team");
  if (shepherdTeam.length > 0) {
    const team = getListByName(orgId, SHEPHERD_TEAM_LIST);
    const n = Math.max(0, (team?.members.length ?? 0) - 1);
    for (const id of shepherdTeam)
      set("shepherd_team", id, n, "everyone else on the shepherd team");
  }

  return out;
}
