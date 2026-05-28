import "server-only";
import { getDb } from "./db";
import { STAFF_LIST_NAME } from "./assignments-read";

/** What each row on the /shepherd-team page summarizes. The four
 *  bucket counts are deliberately non-overlapping — a person reached
 *  through MULTIPLE pathways (e.g. a staff member who's also a group
 *  leader the shepherd oversees) is counted only in their strongest
 *  bucket, with the priority being:
 *
 *    volunteer leaders > congregants > care (non-shepherded) > staff
 *
 *  That order matches how the user described the buckets — staff
 *  comes last so it's the residual "people assigned directly that
 *  aren't already accounted for through a roster". */
export interface ShepherdBreakdown {
  personId: string;
  /** Group + team leaders of units this shepherd oversees via the
   *  shepherd map. Distinct people. */
  volunteerLeaders: number;
  /** Members (non-leaders) of groups + teams this shepherd directly
   *  leads in PCO. Distinct people. */
  congregants: number;
  /** Care-roster assignments to people not currently in any group
   *  or team. */
  careNonShepherded: number;
  /** Staff list members directly assigned to this shepherd (person
   *  or membership_type kind), minus anyone already counted in the
   *  three buckets above. */
  staffDirect: number;
  /** Total distinct people reached across all four buckets. Useful
   *  as the column header sum. */
  totalReach: number;
}

/** Compute the four-bucket breakdown for every shepherd team member
 *  in one pass. Designed to be a single render-time call so the
 *  /shepherd-team page doesn't fan out into N+1 queries.
 *
 *  Strategy:
 *   1) Pull every "raw" relation in a small fixed number of queries
 *      (assignments, care, group leaderships, team leaderships,
 *      staff list, member rosters).
 *   2) For each shepherd, walk the relations and bucket each
 *      reached personId by priority. */
export function getShepherdTeamBreakdown(
  orgId: number,
  shepherdPersonIds: string[],
): Map<string, ShepherdBreakdown> {
  const out = new Map<string, ShepherdBreakdown>();
  if (shepherdPersonIds.length === 0) return out;
  const db = getDb();
  const uniqueShepherds = [...new Set(shepherdPersonIds.filter(Boolean))];
  if (uniqueShepherds.length === 0) return out;

  // ─── Staff list (shared across all shepherds) ────────────────
  const staffIds = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT p.pco_id AS id
             FROM pco_list_memberships m
             JOIN pco_lists l
               ON l.org_id = m.org_id AND l.pco_id = m.list_id
             JOIN pco_people p
               ON p.org_id = m.org_id AND p.pco_id = m.person_id
            WHERE m.org_id = ? AND l.name = ?`,
        )
        .all(orgId, STAFF_LIST_NAME) as Array<{ id: string }>
    ).map((r) => r.id),
  );

  // ─── All shepherd_assignments by these shepherds ──────────────
  const shepherdIn = uniqueShepherds.map(() => "?").join(",");
  const assignRows = db
    .prepare(
      `SELECT shepherd_person_id AS shepherdId,
              target_kind        AS kind,
              target_id          AS targetId
         FROM shepherd_assignments
        WHERE org_id = ?
          AND shepherd_person_id IN (${shepherdIn})`,
    )
    .all(orgId, ...uniqueShepherds) as Array<{
    shepherdId: string;
    kind: string;
    targetId: string;
  }>;

  // ─── Care-roster assignments ─────────────────────────────────
  const careRows = db
    .prepare(
      `SELECT shepherd_person_id AS shepherdId,
              person_id          AS personId
         FROM care_assignments
        WHERE org_id = ?
          AND shepherd_person_id IN (${shepherdIn})`,
    )
    .all(orgId, ...uniqueShepherds) as Array<{
    shepherdId: string;
    personId: string;
  }>;

  // ─── Groups + teams led by these shepherds (in PCO) ───────────
  // For each, list members + leaders so we can split into
  // "congregants" (non-leader members of led units) and "volunteer
  // leaders" (leaders of overseen units).
  const ledGroupRows = db
    .prepare(
      `SELECT m.person_id AS shepherdId, m.group_id AS unitId
         FROM pco_group_memberships m
         JOIN pco_groups g
           ON g.org_id = m.org_id AND g.pco_id = m.group_id
        WHERE m.org_id = ?
          AND m.person_id IN (${shepherdIn})
          AND m.archived_at IS NULL
          AND g.archived_at IS NULL
          AND lower(coalesce(m.role,'')) LIKE '%leader%'`,
    )
    .all(orgId, ...uniqueShepherds) as Array<{
    shepherdId: string;
    unitId: string;
  }>;
  const ledTeamRows = db
    .prepare(
      `SELECT DISTINCT m.person_id AS shepherdId, m.team_id AS unitId
         FROM pco_team_memberships m
         JOIN pco_teams t
           ON t.org_id = m.org_id AND t.pco_id = m.team_id
        WHERE m.org_id = ?
          AND m.person_id IN (${shepherdIn})
          AND m.archived_at IS NULL AND m.person_id != ''
          AND m.is_team_leader = 1
          AND t.archived_at IS NULL AND t.deleted_at IS NULL`,
    )
    .all(orgId, ...uniqueShepherds) as Array<{
    shepherdId: string;
    unitId: string;
  }>;

  // ─── Overseen groups + teams (via shepherd_assignments) ───────
  // group_type expands to every group of that type; service_type to
  // every team of that type. We fetch those expansions in one query
  // per kind so the per-shepherd loop has cheap O(1) lookups.
  const overseenGroupIds = new Set<string>();
  const overseenTeamIds = new Set<string>();
  const overseenGroupTypeIds = new Set<string>();
  const overseenServiceTypeIds = new Set<string>();
  for (const a of assignRows) {
    if (a.kind === "group") overseenGroupIds.add(a.targetId);
    else if (a.kind === "team") overseenTeamIds.add(a.targetId);
    else if (a.kind === "group_type") overseenGroupTypeIds.add(a.targetId);
    else if (a.kind === "service_type") overseenServiceTypeIds.add(a.targetId);
  }
  // Expand group_type / service_type to concrete units.
  const groupTypeToGroups = new Map<string, string[]>();
  if (overseenGroupTypeIds.size > 0) {
    const ids = [...overseenGroupTypeIds];
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT pco_id AS id, group_type_id AS typeId FROM pco_groups
          WHERE org_id = ? AND group_type_id IN (${placeholders})
            AND archived_at IS NULL`,
      )
      .all(orgId, ...ids) as Array<{ id: string; typeId: string }>;
    for (const r of rows) {
      const arr = groupTypeToGroups.get(r.typeId) ?? [];
      arr.push(r.id);
      groupTypeToGroups.set(r.typeId, arr);
    }
  }
  const serviceTypeToTeams = new Map<string, string[]>();
  if (overseenServiceTypeIds.size > 0) {
    const ids = [...overseenServiceTypeIds];
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT pco_id AS id, service_type_id AS typeId FROM pco_teams
          WHERE org_id = ? AND service_type_id IN (${placeholders})
            AND archived_at IS NULL AND deleted_at IS NULL`,
      )
      .all(orgId, ...ids) as Array<{ id: string; typeId: string }>;
    for (const r of rows) {
      const arr = serviceTypeToTeams.get(r.typeId) ?? [];
      arr.push(r.id);
      serviceTypeToTeams.set(r.typeId, arr);
    }
  }

  // Per shepherd: set of overseen group ids + overseen team ids.
  // Built once below from the assignment rows + the type expansions.
  const overseenGroupsBy = new Map<string, Set<string>>();
  const overseenTeamsBy = new Map<string, Set<string>>();
  for (const a of assignRows) {
    if (a.kind === "group") {
      const s =
        overseenGroupsBy.get(a.shepherdId) ?? new Set<string>();
      s.add(a.targetId);
      overseenGroupsBy.set(a.shepherdId, s);
    } else if (a.kind === "group_type") {
      const s =
        overseenGroupsBy.get(a.shepherdId) ?? new Set<string>();
      for (const gid of groupTypeToGroups.get(a.targetId) ?? []) s.add(gid);
      overseenGroupsBy.set(a.shepherdId, s);
    } else if (a.kind === "team") {
      const s = overseenTeamsBy.get(a.shepherdId) ?? new Set<string>();
      s.add(a.targetId);
      overseenTeamsBy.set(a.shepherdId, s);
    } else if (a.kind === "service_type") {
      const s = overseenTeamsBy.get(a.shepherdId) ?? new Set<string>();
      for (const tid of serviceTypeToTeams.get(a.targetId) ?? []) s.add(tid);
      overseenTeamsBy.set(a.shepherdId, s);
    }
  }

  // ─── Per shepherd: led-unit ids ────────────────────────────────
  const ledGroupsBy = new Map<string, Set<string>>();
  for (const r of ledGroupRows) {
    const s = ledGroupsBy.get(r.shepherdId) ?? new Set<string>();
    s.add(r.unitId);
    ledGroupsBy.set(r.shepherdId, s);
  }
  const ledTeamsBy = new Map<string, Set<string>>();
  for (const r of ledTeamRows) {
    const s = ledTeamsBy.get(r.shepherdId) ?? new Set<string>();
    s.add(r.unitId);
    ledTeamsBy.set(r.shepherdId, s);
  }

  // ─── Direct person-kind assignments (also membership_type) ─────
  const directAssignedBy = new Map<string, Set<string>>();
  for (const a of assignRows) {
    if (a.kind !== "person") continue;
    const s = directAssignedBy.get(a.shepherdId) ?? new Set<string>();
    s.add(a.targetId);
    directAssignedBy.set(a.shepherdId, s);
  }
  // Care assignments are also a "directly assigned to this shepherd"
  // signal — bucket them as "care" rather than "direct staff" though.
  const careBy = new Map<string, Set<string>>();
  for (const r of careRows) {
    const s = careBy.get(r.shepherdId) ?? new Set<string>();
    s.add(r.personId);
    careBy.set(r.shepherdId, s);
  }

  // ─── Collect every unit id we'll need member rosters for ─────
  const allRelevantGroupIds = new Set<string>();
  const allRelevantTeamIds = new Set<string>();
  for (const set of overseenGroupsBy.values())
    for (const id of set) allRelevantGroupIds.add(id);
  for (const set of overseenTeamsBy.values())
    for (const id of set) allRelevantTeamIds.add(id);
  for (const set of ledGroupsBy.values())
    for (const id of set) allRelevantGroupIds.add(id);
  for (const set of ledTeamsBy.values())
    for (const id of set) allRelevantTeamIds.add(id);

  // Pull all membership rosters for the involved units.
  type GMembership = {
    groupId: string;
    personId: string;
    isLeader: number;
  };
  const groupMemberships: GMembership[] =
    allRelevantGroupIds.size > 0
      ? (db
          .prepare(
            `SELECT group_id AS groupId, person_id AS personId,
                    CASE WHEN lower(coalesce(role,'')) LIKE '%leader%'
                         THEN 1 ELSE 0 END AS isLeader
               FROM pco_group_memberships
              WHERE org_id = ?
                AND archived_at IS NULL
                AND group_id IN (${[...allRelevantGroupIds]
                  .map(() => "?")
                  .join(",")})`,
          )
          .all(orgId, ...allRelevantGroupIds) as GMembership[])
      : [];
  type TMembership = {
    teamId: string;
    personId: string;
    isLeader: number;
  };
  const teamMemberships: TMembership[] =
    allRelevantTeamIds.size > 0
      ? (db
          .prepare(
            `SELECT team_id AS teamId, person_id AS personId,
                    is_team_leader AS isLeader
               FROM pco_team_memberships
              WHERE org_id = ?
                AND archived_at IS NULL AND person_id != ''
                AND team_id IN (${[...allRelevantTeamIds]
                  .map(() => "?")
                  .join(",")})`,
          )
          .all(orgId, ...allRelevantTeamIds) as TMembership[])
      : [];
  // Index by unit for O(1) lookups.
  const groupMembersByGroup = new Map<string, GMembership[]>();
  for (const r of groupMemberships) {
    const arr = groupMembersByGroup.get(r.groupId) ?? [];
    arr.push(r);
    groupMembersByGroup.set(r.groupId, arr);
  }
  const teamMembersByTeam = new Map<string, TMembership[]>();
  for (const r of teamMemberships) {
    const arr = teamMembersByTeam.get(r.teamId) ?? [];
    arr.push(r);
    teamMembersByTeam.set(r.teamId, arr);
  }

  // ─── "Currently in a group or team" — used to gate care
  //     assignments into the "non-shepherded" bucket. We could
  //     read from person_activity but a single query against the
  //     raw tables avoids the snapshot-staleness risk. ────────────
  const inSomeRoster = new Set<string>(
    (
      db
        .prepare(
          `SELECT DISTINCT person_id FROM (
             SELECT person_id FROM pco_group_memberships
              WHERE org_id = ? AND archived_at IS NULL
             UNION
             SELECT person_id FROM pco_team_memberships
              WHERE org_id = ? AND archived_at IS NULL AND person_id != ''
           )`,
        )
        .all(orgId, orgId) as Array<{ person_id: string }>
    ).map((r) => r.person_id),
  );

  // ─── Per-shepherd bucketing ──────────────────────────────────
  for (const shepherdId of uniqueShepherds) {
    // Volunteer leaders = leaders of overseen groups + teams,
    // excluding the shepherd themselves.
    const volunteerLeaders = new Set<string>();
    for (const gid of overseenGroupsBy.get(shepherdId) ?? []) {
      for (const m of groupMembersByGroup.get(gid) ?? []) {
        if (m.isLeader === 1 && m.personId !== shepherdId) {
          volunteerLeaders.add(m.personId);
        }
      }
    }
    for (const tid of overseenTeamsBy.get(shepherdId) ?? []) {
      for (const m of teamMembersByTeam.get(tid) ?? []) {
        if (m.isLeader === 1 && m.personId !== shepherdId) {
          volunteerLeaders.add(m.personId);
        }
      }
    }

    // Congregants = non-leader members of led groups + teams,
    // minus anyone already counted as a volunteer leader.
    const congregants = new Set<string>();
    for (const gid of ledGroupsBy.get(shepherdId) ?? []) {
      for (const m of groupMembersByGroup.get(gid) ?? []) {
        if (
          m.isLeader === 0 &&
          m.personId !== shepherdId &&
          !volunteerLeaders.has(m.personId)
        ) {
          congregants.add(m.personId);
        }
      }
    }
    for (const tid of ledTeamsBy.get(shepherdId) ?? []) {
      for (const m of teamMembersByTeam.get(tid) ?? []) {
        if (
          m.isLeader === 0 &&
          m.personId !== shepherdId &&
          !volunteerLeaders.has(m.personId)
        ) {
          congregants.add(m.personId);
        }
      }
    }

    // Care (non-shepherded) = care_assignments to people not in any
    // group or team, minus anyone already counted above.
    const careNonShepherded = new Set<string>();
    for (const pid of careBy.get(shepherdId) ?? []) {
      if (pid === shepherdId) continue;
      if (inSomeRoster.has(pid)) continue;
      if (volunteerLeaders.has(pid)) continue;
      if (congregants.has(pid)) continue;
      careNonShepherded.add(pid);
    }

    // Staff direct = staff-list people directly assigned to this
    // shepherd (via person-kind shepherd_assignments) who haven't
    // already been counted in volunteer-leader / congregant / care.
    const staffDirect = new Set<string>();
    for (const pid of directAssignedBy.get(shepherdId) ?? []) {
      if (pid === shepherdId) continue;
      if (!staffIds.has(pid)) continue;
      if (volunteerLeaders.has(pid)) continue;
      if (congregants.has(pid)) continue;
      if (careNonShepherded.has(pid)) continue;
      staffDirect.add(pid);
    }

    out.set(shepherdId, {
      personId: shepherdId,
      volunteerLeaders: volunteerLeaders.size,
      congregants: congregants.size,
      careNonShepherded: careNonShepherded.size,
      staffDirect: staffDirect.size,
      totalReach:
        volunteerLeaders.size +
        congregants.size +
        careNonShepherded.size +
        staffDirect.size,
    });
  }

  return out;
}
