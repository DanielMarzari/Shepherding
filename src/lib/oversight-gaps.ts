import "server-only";
import { getDb } from "./db";
import {
  getExcludedGroupTypes,
  getExcludedTeamTypes,
} from "./pco";

/** Teams and groups nobody on the shepherd team is connected to.
 *
 *  Every team and group has staff oversight in real life — what is
 *  missing is the record of it. That makes this a data gap rather than a
 *  care gap, and the fix is to write the connection down, not to
 *  reclassify the people: being on a roster still means somebody is
 *  shepherding you, and this page is how we learn who.
 *
 *  A roster counts as covered if somebody is connected to it directly or
 *  to its type, since a connection to a whole group type or service type
 *  covers everything under it.
 */

export interface OversightGap {
  kind: "group" | "team";
  /** The id to hand to addAssignments as targetId. */
  id: string;
  name: string;
  /** Its group type or service type, for grouping several at once. */
  typeId: string | null;
  typeName: string | null;
  /** Live members — how much is riding on this one connection. */
  people: number;
}

export interface OversightGaps {
  groups: OversightGap[];
  teams: OversightGap[];
  /** Live rosters of each sort, so the gaps read as "5 of 71". */
  liveGroups: number;
  liveTeams: number;
  /** Distinct people on at least one unconnected roster, counting only
   *  those still in pco_people — a membership row pointing at somebody
   *  PCO no longer has is history, and we cannot name them either, so
   *  including it would make this disagree with the list it links to. */
  peopleAffected: number;
}

export function listOversightGaps(orgId: number): OversightGaps {
  const db = getDb();
  const exGroups = getExcludedGroupTypes(orgId);
  const exTeams = getExcludedTeamTypes(orgId);

  const ph = (xs: string[]) => xs.map(() => "?").join(",");
  const notExGroup = exGroups.length
    ? `AND (g.group_type_id IS NULL OR g.group_type_id NOT IN (${ph(exGroups)}))`
    : "";
  const notExTeam = exTeams.length
    ? `AND (t.service_type_id IS NULL OR t.service_type_id NOT IN (${ph(exTeams)}))`
    : "";

  const groups = db
    .prepare(
      `SELECT g.pco_id AS id, g.name AS name,
              g.group_type_id AS typeId, gt.name AS typeName,
              (SELECT COUNT(DISTINCT m.person_id)
                 FROM pco_group_memberships m
                WHERE m.org_id = g.org_id AND m.group_id = g.pco_id
                  AND m.archived_at IS NULL) AS people
         FROM pco_groups g
         LEFT JOIN pco_group_types gt
           ON gt.org_id = g.org_id AND gt.pco_id = g.group_type_id
        WHERE g.org_id = ? AND g.archived_at IS NULL
          ${notExGroup}
          AND NOT EXISTS (
            SELECT 1 FROM shepherd_assignments a
             WHERE a.org_id = g.org_id
               AND ((a.target_kind = 'group' AND a.target_id = g.pco_id)
                 OR (a.target_kind = 'group_type'
                     AND a.target_id = g.group_type_id)))
        ORDER BY people DESC, name COLLATE NOCASE`,
    )
    .all(orgId, ...exGroups) as Array<{
    id: string;
    name: string | null;
    typeId: string | null;
    typeName: string | null;
    people: number;
  }>;

  const teams = db
    .prepare(
      `SELECT t.pco_id AS id, t.name AS name,
              t.service_type_id AS typeId, st.name AS typeName,
              (SELECT COUNT(DISTINCT m.person_id)
                 FROM pco_team_memberships m
                WHERE m.org_id = t.org_id AND m.team_id = t.pco_id
                  AND m.archived_at IS NULL AND m.person_id != '') AS people
         FROM pco_teams t
         LEFT JOIN pco_service_types st
           ON st.org_id = t.org_id AND st.pco_id = t.service_type_id
        WHERE t.org_id = ? AND t.archived_at IS NULL AND t.deleted_at IS NULL
          ${notExTeam}
          AND NOT EXISTS (
            SELECT 1 FROM shepherd_assignments a
             WHERE a.org_id = t.org_id
               AND ((a.target_kind = 'team' AND a.target_id = t.pco_id)
                 OR (a.target_kind = 'service_type'
                     AND a.target_id = t.service_type_id)))
        ORDER BY people DESC, name COLLATE NOCASE`,
    )
    .all(orgId, ...exTeams) as Array<{
    id: string;
    name: string | null;
    typeId: string | null;
    typeName: string | null;
    people: number;
  }>;

  const liveGroups = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM pco_groups g
          WHERE g.org_id = ? AND g.archived_at IS NULL ${notExGroup}`,
      )
      .get(orgId, ...exGroups) as { n: number }
  ).n;

  const liveTeams = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM pco_teams t
          WHERE t.org_id = ? AND t.archived_at IS NULL AND t.deleted_at IS NULL
            ${notExTeam}`,
      )
      .get(orgId, ...exTeams) as { n: number }
  ).n;

  // Distinct, because one person can sit on several unconnected rosters
  // and counting them twice would overstate the gap.
  const gIds = groups.map((g) => g.id);
  const tIds = teams.map((t) => t.id);
  const people = new Set<string>();
  const known = (ids: string[]) =>
    new Set(
      (
        db
          .prepare(
            `SELECT pco_id AS id FROM pco_people
              WHERE org_id = ? AND pco_id IN (${ph(ids)})`,
          )
          .all(orgId, ...ids) as Array<{ id: string }>
      ).map((r) => r.id),
    );
  if (gIds.length) {
    for (const r of db
      .prepare(
        `SELECT DISTINCT person_id AS id FROM pco_group_memberships
          WHERE org_id = ? AND archived_at IS NULL
            AND group_id IN (${ph(gIds)})`,
      )
      .all(orgId, ...gIds) as Array<{ id: string }>) {
      people.add(r.id);
    }
  }
  if (tIds.length) {
    for (const r of db
      .prepare(
        `SELECT DISTINCT person_id AS id FROM pco_team_memberships
          WHERE org_id = ? AND archived_at IS NULL AND person_id != ''
            AND team_id IN (${ph(tIds)})`,
      )
      .all(orgId, ...tIds) as Array<{ id: string }>) {
      people.add(r.id);
    }
  }
  if (people.size) {
    const live = known([...people]);
    for (const id of [...people]) if (!live.has(id)) people.delete(id);
  }

  const shape = (kind: "group" | "team") =>
    (r: {
      id: string;
      name: string | null;
      typeId: string | null;
      typeName: string | null;
      people: number;
    }): OversightGap => ({
      kind,
      id: r.id,
      name: r.name ?? "(unnamed)",
      typeId: r.typeId,
      typeName: r.typeName,
      people: r.people,
    });

  return {
    groups: groups.map(shape("group")),
    teams: teams.map(shape("team")),
    liveGroups,
    liveTeams,
    peopleAffected: people.size,
  };
}

export interface UntracedPerson {
  personId: string;
  name: string;
  classification: string;
  /** The unconnected rosters they are on, named. */
  rosters: string[];
}

/** The people behind the gap: everyone on a roster nobody is connected
 *  to, with the rosters that put them there.
 *
 *  They are shepherded — somebody runs that team or group — so this is
 *  not a care list. It is the list of people the system cannot name a
 *  shepherd for, which is what makes it a structural gap rather than a
 *  pastoral one, and it shrinks as connections are made on the map.
 */
export function listUntracedPeople(orgId: number): UntracedPerson[] {
  const gaps = listOversightGaps(orgId);
  const groupIds = gaps.groups.map((g) => g.id);
  const teamIds = gaps.teams.map((t) => t.id);
  if (groupIds.length === 0 && teamIds.length === 0) return [];

  const db = getDb();
  const ph = (xs: string[]) => xs.map(() => "?").join(",");
  const rosters = new Map<string, string[]>();

  const note = (pid: string, label: string) => {
    const arr = rosters.get(pid) ?? [];
    if (!arr.includes(label)) arr.push(label);
    rosters.set(pid, arr);
  };

  if (groupIds.length) {
    const byId = new Map(gaps.groups.map((g) => [g.id, g.name]));
    for (const r of db
      .prepare(
        `SELECT DISTINCT person_id AS pid, group_id AS rid
           FROM pco_group_memberships
          WHERE org_id = ? AND archived_at IS NULL
            AND group_id IN (${ph(groupIds)})`,
      )
      .all(orgId, ...groupIds) as Array<{ pid: string; rid: string }>) {
      note(r.pid, byId.get(r.rid) ?? "(group)");
    }
  }
  if (teamIds.length) {
    const byId = new Map(gaps.teams.map((t) => [t.id, t.name]));
    for (const r of db
      .prepare(
        `SELECT DISTINCT person_id AS pid, team_id AS rid
           FROM pco_team_memberships
          WHERE org_id = ? AND archived_at IS NULL AND person_id != ''
            AND team_id IN (${ph(teamIds)})`,
      )
      .all(orgId, ...teamIds) as Array<{ pid: string; rid: string }>) {
      note(r.pid, byId.get(r.rid) ?? "(team)");
    }
  }

  const ids = [...rosters.keys()];
  if (ids.length === 0) return [];

  // Names are plaintext, so they come straight out of pco_people; nothing
  // here touches the encrypted columns.
  const people = db
    .prepare(
      `SELECT p.pco_id AS id, p.first_name AS f, p.last_name AS l,
              COALESCE(pa.classification, 'unknown') AS cls
         FROM pco_people p
         LEFT JOIN person_activity pa
           ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
        WHERE p.org_id = ? AND p.pco_id IN (${ph(ids)})`,
    )
    .all(orgId, ...ids) as Array<{
    id: string;
    f: string | null;
    l: string | null;
    cls: string;
  }>;

  return people
    .map((r) => ({
      personId: r.id,
      name:
        [r.f?.trim(), r.l?.trim()].filter(Boolean).join(" ") ||
        `(unknown #${r.id})`,
      classification: r.cls,
      rosters: rosters.get(r.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
