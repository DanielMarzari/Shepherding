import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import {
  SHEPHERD_TEAM_LIST_NAME,
  type TargetKind,
  listTargetOptions,
} from "./assignments-read";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export type ViaKind = TargetKind | "care";

export interface PersonRef {
  personId: string;
  fullName: string;
  initials: string;
  isMinor: boolean;
}

/** One context through which a shepherd reaches a set of people. */
export interface ShepherdeeGroup {
  via: string;
  viaKind: ViaKind;
  people: PersonRef[];
}

/** One way a given person is shepherded by someone else. */
export interface ShepherdLink {
  shepherd: PersonRef;
  via: string;
  viaKind: ViaKind;
}

function inPlaceholders(n: number): string {
  return Array(n).fill("?").join(",");
}

/** Batch-decrypt names for a set of person ids. */
function namesFor(
  orgId: number,
  ids: string[],
): Map<string, PersonRef> {
  const out = new Map<string, PersonRef>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT pco_id, enc_pii, is_minor FROM pco_people
        WHERE org_id = ? AND pco_id IN (${inPlaceholders(unique.length)})`,
    )
    .all(orgId, ...unique) as Array<{
    pco_id: string;
    enc_pii: string | null;
    is_minor: number;
  }>;
  for (const r of rows) {
    const pii = r.enc_pii ? decryptJson<PIIBlob>(r.enc_pii) : null;
    const first = pii?.first_name ?? null;
    const last = pii?.last_name ?? null;
    out.set(r.pco_id, {
      personId: r.pco_id,
      fullName:
        [first, last].filter(Boolean).join(" ") || `(unknown #${r.pco_id})`,
      initials:
        ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??",
      isMinor: r.is_minor === 1,
    });
  }
  // People with no pco_people row still get a placeholder ref.
  for (const id of unique) {
    if (!out.has(id)) {
      out.set(id, {
        personId: id,
        fullName: `(unknown #${id})`,
        initials: "??",
        isMinor: false,
      });
    }
  }
  return out;
}

/** Resolve a single shepherd-map assignment to the person ids it
 *  covers. The group-type / service-type rule is "leaders only" — per
 *  product: overseeing a *type* means overseeing the leaders of every
 *  group/team of that type, not every member. */
function resolveAssignmentToPersonIds(
  orgId: number,
  kind: TargetKind,
  targetId: string,
): string[] {
  const db = getDb();
  switch (kind) {
    case "group":
      // Members only — a group's leaders are the shepherds of that
      // group, not its sheep, so they aren't shepherded "via" it.
      return (
        db
          .prepare(
            `SELECT DISTINCT person_id AS id FROM pco_group_memberships
              WHERE org_id = ? AND group_id = ? AND archived_at IS NULL
                AND lower(coalesce(role, '')) NOT LIKE '%leader%'`,
          )
          .all(orgId, targetId) as Array<{ id: string }>
      ).map((r) => r.id);
    case "group_type":
      return (
        db
          .prepare(
            `SELECT DISTINCT m.person_id AS id
               FROM pco_group_memberships m
               JOIN pco_groups g
                 ON g.org_id = m.org_id AND g.pco_id = m.group_id
              WHERE m.org_id = ? AND g.group_type_id = ?
                AND m.archived_at IS NULL AND g.archived_at IS NULL
                AND lower(coalesce(m.role, '')) LIKE '%leader%'`,
          )
          .all(orgId, targetId) as Array<{ id: string }>
      ).map((r) => r.id);
    case "team":
      // Non-leaders only — team leaders shepherd the team, they aren't
      // shepherded via it.
      return (
        db
          .prepare(
            `SELECT DISTINCT person_id AS id FROM pco_team_memberships
              WHERE org_id = ? AND team_id = ?
                AND archived_at IS NULL AND person_id != ''
                AND is_team_leader = 0`,
          )
          .all(orgId, targetId) as Array<{ id: string }>
      ).map((r) => r.id);
    case "service_type":
      return (
        db
          .prepare(
            `SELECT DISTINCT m.person_id AS id
               FROM pco_team_memberships m
               JOIN pco_teams t
                 ON t.org_id = m.org_id AND t.pco_id = m.team_id
              WHERE m.org_id = ? AND t.service_type_id = ?
                AND m.archived_at IS NULL AND m.person_id != ''
                AND t.archived_at IS NULL AND t.deleted_at IS NULL
                AND m.is_team_leader = 1`,
          )
          .all(orgId, targetId) as Array<{ id: string }>
      ).map((r) => r.id);
    case "team_position":
      return (
        db
          .prepare(
            `SELECT DISTINCT person_id AS id FROM pco_team_memberships
              WHERE org_id = ? AND position_id = ?
                AND archived_at IS NULL AND person_id != ''`,
          )
          .all(orgId, targetId) as Array<{ id: string }>
      ).map((r) => r.id);
    case "membership_type":
      return (
        db
          .prepare(
            `SELECT pco_id AS id FROM pco_people
              WHERE org_id = ? AND membership_type = ?`,
          )
          .all(orgId, targetId) as Array<{ id: string }>
      ).map((r) => r.id);
    case "shepherd_team":
      // targetId is the "*" sentinel — resolve to the whole team.
      return (
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
          .all(orgId, SHEPHERD_TEAM_LIST_NAME) as Array<{ id: string }>
      ).map((r) => r.id);
    case "reference_list":
      return (
        db
          .prepare(
            `SELECT DISTINCT person_id AS id FROM pco_list_memberships
              WHERE org_id = ? AND list_id = ?`,
          )
          .all(orgId, targetId) as Array<{ id: string }>
      ).map((r) => r.id);
    case "person":
      return [targetId];
  }
}

const VIA_SUFFIX: Record<TargetKind, string> = {
  group: "group members",
  group_type: "group-type leaders",
  team: "team roster",
  service_type: "team leaders",
  team_position: "in this position",
  person: "peer (direct)",
  membership_type: "membership type",
  shepherd_team: "the shepherd team",
  reference_list: "list members",
};

/** People a shepherd reaches — through the shepherd map and through
 *  their direct care roster. Grouped by the context that creates the
 *  link so the UI can show "via the Small Groups type", etc. */
export function getShepherdees(
  orgId: number,
  personId: string,
): ShepherdeeGroup[] {
  const db = getDb();
  const assignments = db
    .prepare(
      `SELECT target_kind AS kind, target_id AS targetId
         FROM shepherd_assignments
        WHERE org_id = ? AND shepherd_person_id = ?
        ORDER BY id`,
    )
    .all(orgId, personId) as Array<{ kind: TargetKind; targetId: string }>;

  // Lazy per-kind name lookup for the target labels.
  const nameMaps = new Map<TargetKind, Map<string, string>>();
  function targetName(kind: TargetKind, id: string): string {
    let m = nameMaps.get(kind);
    if (!m) {
      m = new Map(listTargetOptions(orgId, kind).map((o) => [o.id, o.name]));
      nameMaps.set(kind, m);
    }
    return m.get(id) ?? `#${id}`;
  }

  const raw: Array<{ via: string; viaKind: ViaKind; ids: string[] }> = [];
  const explicitGroupIds = new Set<string>();
  const explicitTeamIds = new Set<string>();
  for (const a of assignments) {
    if (a.kind === "group") explicitGroupIds.add(a.targetId);
    if (a.kind === "team") explicitTeamIds.add(a.targetId);
    const ids = resolveAssignmentToPersonIds(orgId, a.kind, a.targetId).filter(
      (id) => id !== personId,
    );
    raw.push({
      via:
        a.kind === "shepherd_team"
          ? "Shepherd team · everyone else"
          : `${targetName(a.kind, a.targetId)} · ${VIA_SUFFIX[a.kind]}`,
      viaKind: a.kind,
      ids,
    });
  }

  // Direct leadership — a group or team this person leads in PCO is a
  // shepherding relationship in its own right, no map entry required.
  // Units already covered by an explicit map assignment are skipped so
  // the same group doesn't show twice.
  const ledGroups = db
    .prepare(
      `SELECT DISTINCT g.pco_id AS id, g.name AS name
         FROM pco_group_memberships m
         JOIN pco_groups g
           ON g.org_id = m.org_id AND g.pco_id = m.group_id
        WHERE m.org_id = ? AND m.person_id = ?
          AND m.archived_at IS NULL AND g.archived_at IS NULL
          AND lower(coalesce(m.role, '')) LIKE '%leader%'`,
    )
    .all(orgId, personId) as Array<{ id: string; name: string | null }>;
  for (const g of ledGroups) {
    if (explicitGroupIds.has(g.id)) continue;
    raw.push({
      via: `Leads ${g.name ?? "a group"} · group members`,
      viaKind: "group",
      ids: resolveAssignmentToPersonIds(orgId, "group", g.id).filter(
        (id) => id !== personId,
      ),
    });
  }
  const ledTeams = db
    .prepare(
      `SELECT DISTINCT t.pco_id AS id, t.name AS name
         FROM pco_team_memberships m
         JOIN pco_teams t
           ON t.org_id = m.org_id AND t.pco_id = m.team_id
        WHERE m.org_id = ? AND m.person_id = ?
          AND m.archived_at IS NULL AND m.person_id != ''
          AND t.archived_at IS NULL AND t.deleted_at IS NULL
          AND m.is_team_leader = 1`,
    )
    .all(orgId, personId) as Array<{ id: string; name: string | null }>;
  for (const t of ledTeams) {
    if (explicitTeamIds.has(t.id)) continue;
    raw.push({
      via: `Leads ${t.name ?? "a team"} · team roster`,
      viaKind: "team",
      ids: resolveAssignmentToPersonIds(orgId, "team", t.id).filter(
        (id) => id !== personId,
      ),
    });
  }

  // Direct care roster.
  const careIds = (
    db
      .prepare(
        `SELECT person_id AS id FROM care_assignments
          WHERE org_id = ? AND shepherd_person_id = ?`,
      )
      .all(orgId, personId) as Array<{ id: string }>
  )
    .map((r) => r.id)
    .filter((id) => id !== personId);
  if (careIds.length > 0) {
    raw.push({ via: "Care roster", viaKind: "care", ids: careIds });
  }

  const allIds = raw.flatMap((r) => r.ids);
  const names = namesFor(orgId, allIds);

  return raw
    .filter((r) => r.ids.length > 0)
    .map((r) => ({
      via: r.via,
      viaKind: r.viaKind,
      people: [...new Set(r.ids)]
        .map((id) => names.get(id)!)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    }));
}

/** The reverse: every shepherd who covers this person, and how. Driven
 *  by the person's own group / team memberships so it stays cheap — we
 *  never resolve the whole org graph. */
export function getShepherds(
  orgId: number,
  personId: string,
): ShepherdLink[] {
  const db = getDb();

  // This person's live group memberships (with leader flag + type).
  const groupRows = db
    .prepare(
      `SELECT g.pco_id AS groupId, g.name AS groupName,
              g.group_type_id AS groupTypeId, gt.name AS groupTypeName,
              CASE WHEN lower(coalesce(m.role, '')) LIKE '%leader%'
                   THEN 1 ELSE 0 END AS isLeader
         FROM pco_group_memberships m
         JOIN pco_groups g
           ON g.org_id = m.org_id AND g.pco_id = m.group_id
    LEFT JOIN pco_group_types gt
           ON gt.org_id = g.org_id AND gt.pco_id = g.group_type_id
        WHERE m.org_id = ? AND m.person_id = ?
          AND m.archived_at IS NULL AND g.archived_at IS NULL`,
    )
    .all(orgId, personId) as Array<{
    groupId: string;
    groupName: string | null;
    groupTypeId: string | null;
    groupTypeName: string | null;
    isLeader: number;
  }>;

  // This person's live team memberships.
  const teamRows = db
    .prepare(
      `SELECT t.pco_id AS teamId, t.name AS teamName,
              t.service_type_id AS serviceTypeId, st.name AS serviceTypeName,
              m.position_id AS positionId, m.position_name AS positionName,
              m.is_team_leader AS isLeader
         FROM pco_team_memberships m
         JOIN pco_teams t
           ON t.org_id = m.org_id AND t.pco_id = m.team_id
    LEFT JOIN pco_service_types st
           ON st.org_id = t.org_id AND st.pco_id = t.service_type_id
        WHERE m.org_id = ? AND m.person_id = ?
          AND m.archived_at IS NULL AND m.person_id != ''
          AND t.archived_at IS NULL AND t.deleted_at IS NULL`,
    )
    .all(orgId, personId) as Array<{
    teamId: string;
    teamName: string | null;
    serviceTypeId: string | null;
    serviceTypeName: string | null;
    positionId: string | null;
    positionName: string | null;
    isLeader: number;
  }>;

  // (shepherdId, via) -> link. Keyed so the same shepherd via the same
  // context only appears once.
  const links = new Map<string, { shepherdId: string; via: string; viaKind: ViaKind }>();
  function add(shepherdId: string, via: string, viaKind: ViaKind) {
    if (shepherdId === personId) return;
    links.set(`${shepherdId} ${via}`, { shepherdId, via, viaKind });
  }

  // Query helper: shepherd_assignments of a kind whose target_id is in
  // the given set. Returns rows of (shepherd_person_id, target_id).
  function assignmentsFor(
    kind: TargetKind,
    targetIds: string[],
  ): Array<{ shepherdId: string; targetId: string }> {
    const ids = [...new Set(targetIds.filter(Boolean))];
    if (ids.length === 0) return [];
    return (
      db
        .prepare(
          `SELECT shepherd_person_id AS shepherdId, target_id AS targetId
             FROM shepherd_assignments
            WHERE org_id = ? AND target_kind = ?
              AND target_id IN (${inPlaceholders(ids.length)})`,
        )
        .all(orgId, kind, ...ids) as Array<{
        shepherdId: string;
        targetId: string;
      }>
    );
  }

  // Groups this person is a NON-leader member of. A leader isn't
  // shepherded "in" the group they lead, so those groups are excluded
  // from the member-level paths below.
  const memberGroupIds = groupRows
    .filter((g) => g.isLeader === 0)
    .map((g) => g.groupId);
  const memberTeamIds = teamRows
    .filter((t) => t.isLeader === 0)
    .map((t) => t.teamId);

  // group -> anyone overseeing that exact group.
  const groupById = new Map(groupRows.map((g) => [g.groupId, g]));
  for (const r of assignmentsFor("group", memberGroupIds)) {
    const g = groupById.get(r.targetId);
    if (g) {
      add(r.shepherdId, `Member of ${g.groupName ?? "a group"}`, "group");
    }
  }

  // group_type -> anyone overseeing the type, IF this person leads a
  // group of that type (group-type oversight = leaders).
  const leaderGroups = groupRows.filter(
    (g) => g.isLeader === 1 && g.groupTypeId,
  );
  const typeToLeaderGroups = new Map<string, typeof leaderGroups>();
  for (const g of leaderGroups) {
    const arr = typeToLeaderGroups.get(g.groupTypeId!) ?? [];
    arr.push(g);
    typeToLeaderGroups.set(g.groupTypeId!, arr);
  }
  for (const r of assignmentsFor("group_type", [...typeToLeaderGroups.keys()])) {
    for (const g of typeToLeaderGroups.get(r.targetId) ?? []) {
      add(
        r.shepherdId,
        `Leads ${g.groupName ?? "a group"}${g.groupTypeName ? ` (${g.groupTypeName})` : ""}`,
        "group_type",
      );
    }
  }

  // team -> anyone overseeing that exact team.
  const teamById = new Map(teamRows.map((t) => [t.teamId, t]));
  for (const r of assignmentsFor("team", memberTeamIds)) {
    const t = teamById.get(r.targetId);
    if (t) {
      add(r.shepherdId, `On team ${t.teamName ?? "a team"}`, "team");
    }
  }

  // service_type -> anyone overseeing the service type, IF this person
  // is a team leader on a team of that service type.
  const leaderTeams = teamRows.filter(
    (t) => t.isLeader === 1 && t.serviceTypeId,
  );
  const stToLeaderTeams = new Map<string, typeof leaderTeams>();
  for (const t of leaderTeams) {
    const arr = stToLeaderTeams.get(t.serviceTypeId!) ?? [];
    arr.push(t);
    stToLeaderTeams.set(t.serviceTypeId!, arr);
  }
  for (const r of assignmentsFor("service_type", [...stToLeaderTeams.keys()])) {
    for (const t of stToLeaderTeams.get(r.targetId) ?? []) {
      add(
        r.shepherdId,
        `Leads team ${t.teamName ?? "a team"}${t.serviceTypeName ? ` (${t.serviceTypeName})` : ""}`,
        "service_type",
      );
    }
  }

  // team_position -> anyone overseeing a position this person holds.
  const positionToTeams = new Map<string, typeof teamRows>();
  for (const t of teamRows) {
    if (!t.positionId) continue;
    const arr = positionToTeams.get(t.positionId) ?? [];
    arr.push(t);
    positionToTeams.set(t.positionId, arr);
  }
  for (const r of assignmentsFor("team_position", [...positionToTeams.keys()])) {
    for (const t of positionToTeams.get(r.targetId) ?? []) {
      add(
        r.shepherdId,
        `${t.positionName ?? "Position"} on ${t.teamName ?? "a team"}`,
        "team_position",
      );
    }
  }

  // Direct leadership — whoever LEADS a group or team this person is in
  // shepherds them, even with no map assignment. Only groups/teams this
  // person is a NON-leader member of count: co-leaders don't shepherd
  // one another. This keeps getShepherds the true inverse of
  // getShepherdees (which already counts leadership the same way).
  if (memberGroupIds.length > 0) {
    const gids = [...new Set(memberGroupIds)];
    for (const r of db
      .prepare(
        `SELECT DISTINCT person_id AS shepherdId, group_id AS groupId
           FROM pco_group_memberships
          WHERE org_id = ? AND archived_at IS NULL
            AND lower(coalesce(role, '')) LIKE '%leader%'
            AND group_id IN (${inPlaceholders(gids.length)})`,
      )
      .all(orgId, ...gids) as Array<{ shepherdId: string; groupId: string }>) {
      const g = groupById.get(r.groupId);
      add(r.shepherdId, `Leads ${g?.groupName ?? "your group"}`, "group");
    }
  }
  if (memberTeamIds.length > 0) {
    const tids = [...new Set(memberTeamIds)];
    for (const r of db
      .prepare(
        `SELECT DISTINCT person_id AS shepherdId, team_id AS teamId
           FROM pco_team_memberships
          WHERE org_id = ? AND archived_at IS NULL AND person_id != ''
            AND is_team_leader = 1
            AND team_id IN (${inPlaceholders(tids.length)})`,
      )
      .all(orgId, ...tids) as Array<{ shepherdId: string; teamId: string }>) {
      const t = teamById.get(r.teamId);
      add(r.shepherdId, `Leads ${t?.teamName ?? "your team"}`, "team");
    }
  }

  // membership_type -> anyone overseeing this person's membership type.
  const personRow = db
    .prepare(
      `SELECT membership_type AS membershipType
         FROM pco_people WHERE org_id = ? AND pco_id = ?`,
    )
    .get(orgId, personId) as { membershipType: string | null } | undefined;
  if (personRow?.membershipType) {
    for (const r of db
      .prepare(
        `SELECT shepherd_person_id AS shepherdId
           FROM shepherd_assignments
          WHERE org_id = ? AND target_kind = 'membership_type'
            AND target_id = ?`,
      )
      .all(orgId, personRow.membershipType) as Array<{ shepherdId: string }>) {
      add(
        r.shepherdId,
        `Membership type: ${personRow.membershipType}`,
        "membership_type",
      );
    }
  }

  // shepherd_team -> if this person is on the shepherd team, anyone
  // with the shepherd-team-leader assignment oversees them.
  const onShepherdTeam = db
    .prepare(
      `SELECT 1 FROM pco_list_memberships m
         JOIN pco_lists l
           ON l.org_id = m.org_id AND l.pco_id = m.list_id
        WHERE m.org_id = ? AND m.person_id = ? AND l.name = ?
        LIMIT 1`,
    )
    .get(orgId, personId, SHEPHERD_TEAM_LIST_NAME);
  if (onShepherdTeam) {
    for (const r of db
      .prepare(
        `SELECT shepherd_person_id AS shepherdId
           FROM shepherd_assignments
          WHERE org_id = ? AND target_kind = 'shepherd_team'`,
      )
      .all(orgId) as Array<{ shepherdId: string }>) {
      add(r.shepherdId, "Shepherd-team oversight", "shepherd_team");
    }
  }

  // reference_list -> anyone overseeing a REFERENCE list this person
  // belongs to (staff, elders, deacons, etc.).
  const listRows = db
    .prepare(
      `SELECT m.list_id AS listId, l.name AS listName
         FROM pco_list_memberships m
         JOIN pco_lists l
           ON l.org_id = m.org_id AND l.pco_id = m.list_id
        WHERE m.org_id = ? AND m.person_id = ?`,
    )
    .all(orgId, personId) as Array<{ listId: string; listName: string | null }>;
  const listNameById = new Map(listRows.map((l) => [l.listId, l.listName]));
  for (const r of assignmentsFor(
    "reference_list",
    listRows.map((l) => l.listId),
  )) {
    add(
      r.shepherdId,
      `On list "${listNameById.get(r.targetId) ?? "a list"}"`,
      "reference_list",
    );
  }

  // Direct peer assignment — a shepherd assigned this person directly.
  for (const r of db
    .prepare(
      `SELECT shepherd_person_id AS shepherdId
         FROM shepherd_assignments
        WHERE org_id = ? AND target_kind = 'person' AND target_id = ?`,
    )
    .all(orgId, personId) as Array<{ shepherdId: string }>) {
    add(r.shepherdId, "Direct peer assignment", "person");
  }

  // Care roster — whoever has taken direct pastoral care of them.
  for (const r of db
    .prepare(
      `SELECT shepherd_person_id AS shepherdId
         FROM care_assignments
        WHERE org_id = ? AND person_id = ?`,
    )
    .all(orgId, personId) as Array<{ shepherdId: string }>) {
    add(r.shepherdId, "Care roster", "care");
  }

  const list = [...links.values()];
  const names = namesFor(
    orgId,
    list.map((l) => l.shepherdId),
  );
  return list
    .map((l) => ({
      shepherd: names.get(l.shepherdId)!,
      via: l.via,
      viaKind: l.viaKind,
    }))
    .sort((a, b) => a.shepherd.fullName.localeCompare(b.shepherd.fullName));
}

// ─── Leader-oversight lookup (used by /shepherds list) ────────────

export interface LeaderOverseer {
  shepherd: PersonRef;
  /** Short label like "Leads Tuesday Men's Bible Study (Small Groups)". */
  via: string;
  viaKind: "group" | "group_type" | "team" | "service_type";
}

/** Who oversees this person *as a leader* of a group or team — i.e.
 *  the shepherd-map assignment(s) covering a unit they actually lead.
 *  This is the relationship surfaced in the /shepherds "Overseen by"
 *  column: a small-group leader is overseen by whoever in the shepherd
 *  team is assigned to the group, its group type, the specific team, or
 *  its service type.
 *
 *  Unlike getShepherds, this DOES return shepherds via per-group /
 *  per-team assignments even though those assignments normally cover
 *  members-not-leaders — the leader IS the unit, so an explicit
 *  oversight assignment on the unit covers them. */
export function getLeaderOverseers(
  orgId: number,
  personId: string,
): LeaderOverseer[] {
  const db = getDb();
  const groupRows = db
    .prepare(
      `SELECT g.pco_id AS groupId, g.name AS groupName,
              g.group_type_id AS groupTypeId, gt.name AS groupTypeName
         FROM pco_group_memberships m
         JOIN pco_groups g
           ON g.org_id = m.org_id AND g.pco_id = m.group_id
    LEFT JOIN pco_group_types gt
           ON gt.org_id = g.org_id AND gt.pco_id = g.group_type_id
        WHERE m.org_id = ? AND m.person_id = ?
          AND m.archived_at IS NULL AND g.archived_at IS NULL
          AND lower(coalesce(m.role, '')) LIKE '%leader%'`,
    )
    .all(orgId, personId) as Array<{
    groupId: string;
    groupName: string | null;
    groupTypeId: string | null;
    groupTypeName: string | null;
  }>;
  const teamRows = db
    .prepare(
      `SELECT DISTINCT t.pco_id AS teamId, t.name AS teamName,
              t.service_type_id AS serviceTypeId, st.name AS serviceTypeName
         FROM pco_team_memberships m
         JOIN pco_teams t
           ON t.org_id = m.org_id AND t.pco_id = m.team_id
    LEFT JOIN pco_service_types st
           ON st.org_id = t.org_id AND st.pco_id = t.service_type_id
        WHERE m.org_id = ? AND m.person_id = ?
          AND m.archived_at IS NULL AND m.person_id != ''
          AND m.is_team_leader = 1
          AND t.archived_at IS NULL AND t.deleted_at IS NULL`,
    )
    .all(orgId, personId) as Array<{
    teamId: string;
    teamName: string | null;
    serviceTypeId: string | null;
    serviceTypeName: string | null;
  }>;

  // (shepherdId, via) -> link. Dedup so the same overseer via the same
  // context appears once even if the underlying SQL returns dupes.
  const links = new Map<
    string,
    { shepherdId: string; via: string; viaKind: LeaderOverseer["viaKind"] }
  >();
  function add(
    shepherdId: string,
    via: string,
    viaKind: LeaderOverseer["viaKind"],
  ) {
    if (shepherdId === personId) return;
    links.set(`${shepherdId}::${via}`, { shepherdId, via, viaKind });
  }

  function fetchAssignments(
    kind: LeaderOverseer["viaKind"],
    ids: string[],
  ): Array<{ shepherdId: string; targetId: string }> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    return db
      .prepare(
        `SELECT shepherd_person_id AS shepherdId, target_id AS targetId
           FROM shepherd_assignments
          WHERE org_id = ? AND target_kind = ?
            AND target_id IN (${inPlaceholders(unique.length)})`,
      )
      .all(orgId, kind, ...unique) as Array<{
      shepherdId: string;
      targetId: string;
    }>;
  }

  const groupById = new Map(groupRows.map((g) => [g.groupId, g]));
  for (const r of fetchAssignments(
    "group",
    groupRows.map((g) => g.groupId),
  )) {
    const g = groupById.get(r.targetId);
    add(r.shepherdId, `Leads ${g?.groupName ?? "a group"}`, "group");
  }
  // group_type -> may cover multiple groups this person leads. Show one
  // line per led group so the user sees exactly which leader role this
  // overseer covers.
  const typeToLedGroups = new Map<string, typeof groupRows>();
  for (const g of groupRows) {
    if (!g.groupTypeId) continue;
    const arr = typeToLedGroups.get(g.groupTypeId) ?? [];
    arr.push(g);
    typeToLedGroups.set(g.groupTypeId, arr);
  }
  for (const r of fetchAssignments(
    "group_type",
    [...typeToLedGroups.keys()],
  )) {
    for (const g of typeToLedGroups.get(r.targetId) ?? []) {
      add(
        r.shepherdId,
        `Leads ${g.groupName ?? "a group"}${g.groupTypeName ? ` (${g.groupTypeName})` : ""}`,
        "group_type",
      );
    }
  }

  const teamById = new Map(teamRows.map((t) => [t.teamId, t]));
  for (const r of fetchAssignments(
    "team",
    teamRows.map((t) => t.teamId),
  )) {
    const t = teamById.get(r.targetId);
    add(r.shepherdId, `Leads ${t?.teamName ?? "a team"}`, "team");
  }
  const stToLedTeams = new Map<string, typeof teamRows>();
  for (const t of teamRows) {
    if (!t.serviceTypeId) continue;
    const arr = stToLedTeams.get(t.serviceTypeId) ?? [];
    arr.push(t);
    stToLedTeams.set(t.serviceTypeId, arr);
  }
  for (const r of fetchAssignments(
    "service_type",
    [...stToLedTeams.keys()],
  )) {
    for (const t of stToLedTeams.get(r.targetId) ?? []) {
      add(
        r.shepherdId,
        `Leads ${t.teamName ?? "a team"}${t.serviceTypeName ? ` (${t.serviceTypeName})` : ""}`,
        "service_type",
      );
    }
  }

  const list = [...links.values()];
  const names = namesFor(
    orgId,
    list.map((l) => l.shepherdId),
  );
  return list
    .map((l) => ({
      shepherd: names.get(l.shepherdId)!,
      via: l.via,
      viaKind: l.viaKind,
    }))
    .sort((a, b) => a.shepherd.fullName.localeCompare(b.shepherd.fullName));
}

/** Co-shepherd info for the /people/[slug] ShepherdingOverview card.
 *  For a set of flock people (typically 20-200 for an active pastor),
 *  returns Map<personId, Array<{shepherdId, shepherdName}>> of OTHER
 *  shepherds reaching each of them — used to split the flock into
 *  "exclusive" vs "co-shepherded".
 *
 *  The full getShepherds() considers ten different paths someone can
 *  be shepherded through. This batch focuses on the four that dominate
 *  real pastoral data — direct group leadership, direct team
 *  leadership, care-roster assignments, and direct person assignments
 *  — because those are the only ones that actually carry meaningful
 *  volume per flock. The rarer paths (group_type / service_type /
 *  team_position / membership_type / reference_list / shepherd_team
 *  expansions) are skipped here; if a co-shepherd relationship exists
 *  ONLY through one of those it won't surface, but the alternative is
 *  the N+1 we're trying to kill.
 *
 *  Fixed query count: 5 indexed queries regardless of flock size, vs.
 *  the previous ~12 × N pattern. */
export function getCoShepherdsBatch(
  orgId: number,
  personIds: string[],
  excludeShepherdId: string,
): Map<string, Array<{ shepherdId: string; shepherdName: string }>> {
  const out = new Map<
    string,
    Array<{ shepherdId: string; shepherdName: string }>
  >();
  const flock = [...new Set(personIds.filter((p) => p !== excludeShepherdId))];
  if (flock.length === 0) return out;
  const db = getDb();
  const ph = inPlaceholders(flock.length);

  // accumulated other-shepherd ids per flock person (deduped)
  const byPerson = new Map<string, Set<string>>();
  function add(personId: string, shepherdId: string): void {
    if (shepherdId === excludeShepherdId) return;
    if (shepherdId === personId) return;
    let s = byPerson.get(personId);
    if (!s) {
      s = new Set();
      byPerson.set(personId, s);
    }
    s.add(shepherdId);
  }

  // 1) Other group leaders of any group a flock member is a NON-leader
  //    member of. The self-join finds (member-side row, leader-side
  //    row) pairs in one indexed scan.
  for (const r of db
    .prepare(
      `SELECT mm.person_id AS personId,
              ml.person_id AS shepherdId
         FROM pco_group_memberships mm
         JOIN pco_group_memberships ml
           ON ml.org_id = mm.org_id
          AND ml.group_id = mm.group_id
          AND ml.archived_at IS NULL
          AND lower(coalesce(ml.role,'')) LIKE '%leader%'
         JOIN pco_groups g
           ON g.org_id = mm.org_id AND g.pco_id = mm.group_id
        WHERE mm.org_id = ?
          AND mm.person_id IN (${ph})
          AND mm.archived_at IS NULL
          AND g.archived_at IS NULL
          AND lower(coalesce(mm.role,'')) NOT LIKE '%leader%'`,
    )
    .all(orgId, ...flock) as Array<{
    personId: string;
    shepherdId: string;
  }>) {
    add(r.personId, r.shepherdId);
  }

  // 2) Other team leaders of any team a flock member is a non-leader
  //    of. Same self-join pattern.
  for (const r of db
    .prepare(
      `SELECT mm.person_id AS personId,
              ml.person_id AS shepherdId
         FROM pco_team_memberships mm
         JOIN pco_team_memberships ml
           ON ml.org_id = mm.org_id
          AND ml.team_id = mm.team_id
          AND ml.archived_at IS NULL
          AND ml.person_id != ''
          AND ml.is_team_leader = 1
         JOIN pco_teams t
           ON t.org_id = mm.org_id AND t.pco_id = mm.team_id
        WHERE mm.org_id = ?
          AND mm.person_id IN (${ph})
          AND mm.archived_at IS NULL AND mm.person_id != ''
          AND mm.is_team_leader = 0
          AND t.archived_at IS NULL AND t.deleted_at IS NULL`,
    )
    .all(orgId, ...flock) as Array<{
    personId: string;
    shepherdId: string;
  }>) {
    add(r.personId, r.shepherdId);
  }

  // 3) Care assignments — anyone else carrying this flock person on
  //    their care roster.
  for (const r of db
    .prepare(
      `SELECT person_id AS personId,
              shepherd_person_id AS shepherdId
         FROM care_assignments
        WHERE org_id = ?
          AND person_id IN (${ph})`,
    )
    .all(orgId, ...flock) as Array<{
    personId: string;
    shepherdId: string;
  }>) {
    add(r.personId, r.shepherdId);
  }

  // 4) Direct person-kind shepherd_assignments to any flock member.
  for (const r of db
    .prepare(
      `SELECT target_id AS personId,
              shepherd_person_id AS shepherdId
         FROM shepherd_assignments
        WHERE org_id = ?
          AND target_kind = 'person'
          AND target_id IN (${ph})`,
    )
    .all(orgId, ...flock) as Array<{
    personId: string;
    shepherdId: string;
  }>) {
    add(r.personId, r.shepherdId);
  }

  // 5) Single batched name decryption for every shepherd id we collected.
  const allShepherds = new Set<string>();
  for (const s of byPerson.values()) for (const id of s) allShepherds.add(id);
  const names = namesFor(orgId, [...allShepherds]);

  for (const [personId, shepherdSet] of byPerson.entries()) {
    const list: Array<{ shepherdId: string; shepherdName: string }> = [];
    for (const sid of shepherdSet) {
      const ref = names.get(sid);
      list.push({
        shepherdId: sid,
        shepherdName: ref?.fullName ?? `(unknown #${sid})`,
      });
    }
    list.sort((a, b) => a.shepherdName.localeCompare(b.shepherdName));
    out.set(personId, list);
  }
  return out;
}

/** Batch variant of getLeaderOverseers — does the whole computation
 *  for N people in a small fixed number of queries instead of
 *  N × ~6 per-person calls. Used by the /shepherds list to eliminate
 *  the N+1 pattern that was running ~600 queries per page render on
 *  real data; same Map<personId, overseers[]> the caller iterates.
 *
 *  Missing entries in the returned Map mean "no overseers". The
 *  shepherd refs inside each LeaderOverseer are sorted by full name
 *  same as the single-person version. */
export function getLeaderOverseersBatch(
  orgId: number,
  personIds: string[],
): Map<string, LeaderOverseer[]> {
  const out = new Map<string, LeaderOverseer[]>();
  const uniqueIds = [...new Set(personIds.filter(Boolean))];
  if (uniqueIds.length === 0) return out;
  const db = getDb();
  const idPlaceholders = inPlaceholders(uniqueIds.length);

  const groupRows = db
    .prepare(
      `SELECT m.person_id   AS personId,
              g.pco_id      AS groupId,
              g.name        AS groupName,
              g.group_type_id AS groupTypeId,
              gt.name       AS groupTypeName
         FROM pco_group_memberships m
         JOIN pco_groups g
           ON g.org_id = m.org_id AND g.pco_id = m.group_id
    LEFT JOIN pco_group_types gt
           ON gt.org_id = g.org_id AND gt.pco_id = g.group_type_id
        WHERE m.org_id = ?
          AND m.person_id IN (${idPlaceholders})
          AND m.archived_at IS NULL
          AND g.archived_at IS NULL
          AND lower(coalesce(m.role, '')) LIKE '%leader%'`,
    )
    .all(orgId, ...uniqueIds) as Array<{
    personId: string;
    groupId: string;
    groupName: string | null;
    groupTypeId: string | null;
    groupTypeName: string | null;
  }>;

  const teamRows = db
    .prepare(
      `SELECT DISTINCT m.person_id AS personId,
              t.pco_id   AS teamId,
              t.name     AS teamName,
              t.service_type_id AS serviceTypeId,
              st.name    AS serviceTypeName
         FROM pco_team_memberships m
         JOIN pco_teams t
           ON t.org_id = m.org_id AND t.pco_id = m.team_id
    LEFT JOIN pco_service_types st
           ON st.org_id = t.org_id AND st.pco_id = t.service_type_id
        WHERE m.org_id = ?
          AND m.person_id IN (${idPlaceholders})
          AND m.archived_at IS NULL AND m.person_id != ''
          AND m.is_team_leader = 1
          AND t.archived_at IS NULL AND t.deleted_at IS NULL`,
    )
    .all(orgId, ...uniqueIds) as Array<{
    personId: string;
    teamId: string;
    teamName: string | null;
    serviceTypeId: string | null;
    serviceTypeName: string | null;
  }>;

  const groupIds = new Set<string>();
  const groupTypeIds = new Set<string>();
  const teamIds = new Set<string>();
  const serviceTypeIds = new Set<string>();
  for (const r of groupRows) {
    groupIds.add(r.groupId);
    if (r.groupTypeId) groupTypeIds.add(r.groupTypeId);
  }
  for (const r of teamRows) {
    teamIds.add(r.teamId);
    if (r.serviceTypeId) serviceTypeIds.add(r.serviceTypeId);
  }

  type AssignRow = {
    kind: LeaderOverseer["viaKind"];
    shepherdId: string;
    targetId: string;
  };
  const assignRows: AssignRow[] = [];
  function fetchKind(
    kind: LeaderOverseer["viaKind"],
    ids: Set<string>,
  ): void {
    if (ids.size === 0) return;
    const arr = [...ids];
    const rows = db
      .prepare(
        `SELECT shepherd_person_id AS shepherdId, target_id AS targetId
           FROM shepherd_assignments
          WHERE org_id = ? AND target_kind = ?
            AND target_id IN (${inPlaceholders(arr.length)})`,
      )
      .all(orgId, kind, ...arr) as Array<{
      shepherdId: string;
      targetId: string;
    }>;
    for (const r of rows) assignRows.push({ kind, ...r });
  }
  fetchKind("group", groupIds);
  fetchKind("group_type", groupTypeIds);
  fetchKind("team", teamIds);
  fetchKind("service_type", serviceTypeIds);

  const assignByTarget = new Map<string, AssignRow[]>();
  for (const a of assignRows) {
    const k = `${a.kind}:${a.targetId}`;
    const arr = assignByTarget.get(k) ?? [];
    arr.push(a);
    assignByTarget.set(k, arr);
  }

  const groupsByPerson = new Map<string, typeof groupRows>();
  for (const r of groupRows) {
    const arr = groupsByPerson.get(r.personId) ?? [];
    arr.push(r);
    groupsByPerson.set(r.personId, arr);
  }
  const teamsByPerson = new Map<string, typeof teamRows>();
  for (const r of teamRows) {
    const arr = teamsByPerson.get(r.personId) ?? [];
    arr.push(r);
    teamsByPerson.set(r.personId, arr);
  }

  const allShepherdIds = new Set<string>();
  const linksByPerson = new Map<
    string,
    Map<string, { shepherdId: string; via: string; viaKind: LeaderOverseer["viaKind"] }>
  >();
  function pushLink(
    personId: string,
    shepherdId: string,
    via: string,
    viaKind: LeaderOverseer["viaKind"],
  ): void {
    if (shepherdId === personId) return;
    let pl = linksByPerson.get(personId);
    if (!pl) {
      pl = new Map();
      linksByPerson.set(personId, pl);
    }
    pl.set(`${shepherdId}::${via}`, { shepherdId, via, viaKind });
    allShepherdIds.add(shepherdId);
  }

  for (const personId of uniqueIds) {
    const groups = groupsByPerson.get(personId) ?? [];
    const teams = teamsByPerson.get(personId) ?? [];
    for (const g of groups) {
      for (const a of assignByTarget.get(`group:${g.groupId}`) ?? []) {
        pushLink(
          personId,
          a.shepherdId,
          `Leads ${g.groupName ?? "a group"}`,
          "group",
        );
      }
    }
    for (const g of groups) {
      if (!g.groupTypeId) continue;
      for (const a of assignByTarget.get(
        `group_type:${g.groupTypeId}`,
      ) ?? []) {
        pushLink(
          personId,
          a.shepherdId,
          `Leads ${g.groupName ?? "a group"}${g.groupTypeName ? ` (${g.groupTypeName})` : ""}`,
          "group_type",
        );
      }
    }
    for (const t of teams) {
      for (const a of assignByTarget.get(`team:${t.teamId}`) ?? []) {
        pushLink(
          personId,
          a.shepherdId,
          `Leads ${t.teamName ?? "a team"}`,
          "team",
        );
      }
    }
    for (const t of teams) {
      if (!t.serviceTypeId) continue;
      for (const a of assignByTarget.get(
        `service_type:${t.serviceTypeId}`,
      ) ?? []) {
        pushLink(
          personId,
          a.shepherdId,
          `Leads ${t.teamName ?? "a team"}${t.serviceTypeName ? ` (${t.serviceTypeName})` : ""}`,
          "service_type",
        );
      }
    }
  }

  // ONE names lookup for every referenced shepherd, regardless of
  // how many input people reference them.
  const names = namesFor(orgId, [...allShepherdIds]);
  for (const [personId, links] of linksByPerson.entries()) {
    const arr = [...links.values()]
      .map((l) => ({
        shepherd: names.get(l.shepherdId)!,
        via: l.via,
        viaKind: l.viaKind,
      }))
      .sort((a, b) => a.shepherd.fullName.localeCompare(b.shepherd.fullName));
    out.set(personId, arr);
  }
  return out;
}
