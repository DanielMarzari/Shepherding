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
  /** Distinct people on at least one unconnected roster. */
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
