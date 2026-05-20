import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { type TargetKind, listTargetOptions } from "./assignments-read";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export type ViaKind = TargetKind | "care";

export interface PersonRef {
  personId: string;
  fullName: string;
  initials: string;
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
      `SELECT pco_id, enc_pii FROM pco_people
        WHERE org_id = ? AND pco_id IN (${inPlaceholders(unique.length)})`,
    )
    .all(orgId, ...unique) as Array<{
    pco_id: string;
    enc_pii: string | null;
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
    });
  }
  // People with no pco_people row still get a placeholder ref.
  for (const id of unique) {
    if (!out.has(id)) {
      out.set(id, {
        personId: id,
        fullName: `(unknown #${id})`,
        initials: "??",
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
      return (
        db
          .prepare(
            `SELECT DISTINCT person_id AS id FROM pco_group_memberships
              WHERE org_id = ? AND group_id = ? AND archived_at IS NULL`,
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
      return (
        db
          .prepare(
            `SELECT DISTINCT person_id AS id FROM pco_team_memberships
              WHERE org_id = ? AND team_id = ?
                AND archived_at IS NULL AND person_id != ''`,
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
  for (const a of assignments) {
    const ids = resolveAssignmentToPersonIds(orgId, a.kind, a.targetId).filter(
      (id) => id !== personId,
    );
    raw.push({
      via: `${targetName(a.kind, a.targetId)} · ${VIA_SUFFIX[a.kind]}`,
      viaKind: a.kind,
      ids,
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

  // group -> anyone overseeing that exact group.
  const groupById = new Map(groupRows.map((g) => [g.groupId, g]));
  for (const r of assignmentsFor(
    "group",
    groupRows.map((g) => g.groupId),
  )) {
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
  for (const r of assignmentsFor(
    "team",
    teamRows.map((t) => t.teamId),
  )) {
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
