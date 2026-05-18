import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export interface ShepherdSummary {
  personId: string;
  fullName: string;
  initials: string;
  groupsLed: Array<{ id: string; name: string | null }>;
  teamsLed: Array<{ id: string; name: string | null }>;
  totalLed: number;
}

/** Everyone who currently leads at least one active group OR team.
 *  Group leaders are detected via `lower(role) LIKE '%leader%'` on
 *  pco_group_memberships (PCO's role enum is literally "leader" for
 *  group leads). Team leaders come from pco_team_memberships.is_team_leader
 *  (which we populate during services sync from /services/v2/teams/{id}/team_leaders). */
export function listShepherds(orgId: number): ShepherdSummary[] {
  const db = getDb();

  const groupRows = db
    .prepare(
      `SELECT m.person_id AS personId, g.pco_id AS id, g.name AS name
         FROM pco_group_memberships m
         JOIN pco_groups g
           ON g.org_id = m.org_id AND g.pco_id = m.group_id
        WHERE m.org_id = ?
          AND m.archived_at IS NULL
          AND g.archived_at IS NULL
          AND lower(coalesce(m.role, '')) LIKE '%leader%'`,
    )
    .all(orgId) as Array<{ personId: string; id: string; name: string | null }>;

  const teamRows = db
    .prepare(
      `SELECT m.person_id AS personId, t.pco_id AS id, t.name AS name
         FROM pco_team_memberships m
         JOIN pco_teams t
           ON t.org_id = m.org_id AND t.pco_id = m.team_id
        WHERE m.org_id = ?
          AND m.archived_at IS NULL
          AND m.is_team_leader = 1
          AND m.person_id != ''
          AND t.archived_at IS NULL
          AND t.deleted_at IS NULL`,
    )
    .all(orgId) as Array<{ personId: string; id: string; name: string | null }>;

  // Roll up into a single shepherd record per personId.
  const map = new Map<
    string,
    {
      groups: Array<{ id: string; name: string | null }>;
      teams: Array<{ id: string; name: string | null }>;
    }
  >();
  for (const r of groupRows) {
    const e = map.get(r.personId) ?? { groups: [], teams: [] };
    e.groups.push({ id: r.id, name: r.name });
    map.set(r.personId, e);
  }
  for (const r of teamRows) {
    const e = map.get(r.personId) ?? { groups: [], teams: [] };
    e.teams.push({ id: r.id, name: r.name });
    map.set(r.personId, e);
  }

  if (map.size === 0) return [];

  // Pull encrypted PII only for the shepherd set — much smaller decrypt
  // pass than the full pco_people table.
  const ids = Array.from(map.keys());
  const placeholders = ids.map(() => "?").join(",");
  const peopleRows = db
    .prepare(
      `SELECT pco_id, enc_pii FROM pco_people
        WHERE org_id = ? AND pco_id IN (${placeholders})`,
    )
    .all(orgId, ...ids) as Array<{ pco_id: string; enc_pii: string | null }>;
  const piiById = new Map<string, PIIBlob>();
  for (const p of peopleRows) {
    const pii = p.enc_pii ? decryptJson<PIIBlob>(p.enc_pii) : null;
    if (pii) piiById.set(p.pco_id, pii);
  }

  const out: ShepherdSummary[] = [];
  for (const [personId, e] of map.entries()) {
    const pii = piiById.get(personId);
    const firstName = pii?.first_name ?? null;
    const lastName = pii?.last_name ?? null;
    const fullName =
      [firstName, lastName].filter(Boolean).join(" ") || `(unknown #${personId})`;
    const initials =
      ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "??";
    // De-dup within each role bucket (a leader on two same-named team rows etc).
    const groupsLed = dedupeById(e.groups);
    const teamsLed = dedupeById(e.teams);
    out.push({
      personId,
      fullName,
      initials,
      groupsLed,
      teamsLed,
      totalLed: groupsLed.length + teamsLed.length,
    });
  }

  // Heaviest workload first; then name.
  out.sort((a, b) => {
    if (a.totalLed !== b.totalLed) return b.totalLed - a.totalLed;
    return a.fullName.localeCompare(b.fullName);
  });
  return out;
}

function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

// ─── Single-shepherd detail (for /shepherds/[id]) ─────────────────────

export interface ShepherdDetailGroup {
  id: string;
  name: string | null;
  members: number;
  leaders: number;
  /** Distinct people who attended this group's events in the last 3mo. */
  recentlyAttended: number;
}

export interface ShepherdDetailTeam {
  id: string;
  name: string | null;
  members: number;
  leaders: number;
  /** Distinct people who served on a plan for this team in the last 3mo. */
  recentlyServed: number;
}

export interface FlockMember {
  personId: string;
  fullName: string;
  initials: string;
  /** Which lanes the shepherd touches them through. */
  lanes: Array<"comm" | "serv">;
  /** "Tuesday Men's Group" / "Coffee Team" — the specific ministry context
   *  they share with the shepherd. First one wins for display. */
  context: string | null;
  /** True iff someone other than this shepherd also leads at least one of
   *  the rosters this person is on (rough "+1 co-shepherd" signal). */
  hasCoShepherd: boolean;
  /** True when the person is under 18 — flock cards dim those so the
   *  pastoral list focuses on adults. */
  isMinor: boolean;
}

export interface ShepherdDetail {
  personId: string;
  fullName: string;
  initials: string;
  isMinor: boolean;
  isParent: boolean;
  birthYear: number | null;
  membershipType: string | null;
  groupsLed: ShepherdDetailGroup[];
  teamsLed: ShepherdDetailTeam[];
  /** Total distinct people this shepherd has direct oversight of via
   *  group / team membership rosters (de-duped across both). */
  flockSize: number;
  /** Distinct people in the flock, with lane + ministry context. */
  flock: FlockMember[];
}

export function getShepherdDetail(
  orgId: number,
  personId: string,
  activityMonths: number,
): ShepherdDetail | null {
  const db = getDb();
  const personRow = db
    .prepare(
      `SELECT enc_pii, membership_type, is_minor, is_parent, birth_year
         FROM pco_people
        WHERE org_id = ? AND pco_id = ?
        LIMIT 1`,
    )
    .get(orgId, personId) as
    | {
        enc_pii: string | null;
        membership_type: string | null;
        is_minor: number;
        is_parent: number;
        birth_year: number | null;
      }
    | undefined;
  if (!personRow) return null;

  const pii = personRow.enc_pii
    ? decryptJson<PIIBlob>(personRow.enc_pii)
    : null;
  const firstName = pii?.first_name ?? null;
  const lastName = pii?.last_name ?? null;
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    `(unknown #${personId})`;
  const initials =
    ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "??";

  const cutoff = new Date(
    Date.now() - activityMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const groupsLed = db
    .prepare(
      `SELECT
         g.pco_id AS id,
         g.name   AS name,
         (SELECT COUNT(*) FROM pco_group_memberships mm
            WHERE mm.org_id = g.org_id AND mm.group_id = g.pco_id
              AND mm.archived_at IS NULL)                   AS members,
         (SELECT COUNT(*) FROM pco_group_memberships mm
            WHERE mm.org_id = g.org_id AND mm.group_id = g.pco_id
              AND mm.archived_at IS NULL
              AND lower(coalesce(mm.role,'')) LIKE '%leader%') AS leaders,
         (SELECT COUNT(DISTINCT a.person_id)
            FROM pco_event_attendances a
           WHERE a.org_id = g.org_id AND a.group_id = g.pco_id
             AND a.attended = 1 AND a.event_starts_at >= ?)   AS recentlyAttended
       FROM pco_group_memberships m
       JOIN pco_groups g
         ON g.org_id = m.org_id AND g.pco_id = m.group_id
      WHERE m.org_id = ?
        AND m.person_id = ?
        AND m.archived_at IS NULL
        AND g.archived_at IS NULL
        AND lower(coalesce(m.role, '')) LIKE '%leader%'
      ORDER BY members DESC, g.name ASC`,
    )
    .all(cutoff, orgId, personId) as ShepherdDetailGroup[];

  // DISTINCT on the outer t.pco_id — PCO models one person across many
  // positions on the same team, so without it a team gets listed once
  // per leader-position the shepherd holds (e.g. Worship gets duplicated
  // because they're both "Worship Lead" AND "Vocalist Lead").
  const teamsLed = db
    .prepare(
      `SELECT DISTINCT
         t.pco_id AS id,
         t.name   AS name,
         (SELECT COUNT(DISTINCT mm.person_id) FROM pco_team_memberships mm
            WHERE mm.org_id = t.org_id AND mm.team_id = t.pco_id
              AND mm.archived_at IS NULL AND mm.person_id != '') AS members,
         (SELECT COUNT(DISTINCT mm.person_id) FROM pco_team_memberships mm
            WHERE mm.org_id = t.org_id AND mm.team_id = t.pco_id
              AND mm.archived_at IS NULL AND mm.person_id != ''
              AND mm.is_team_leader = 1)                          AS leaders,
         (SELECT COUNT(DISTINCT pp.person_id)
            FROM pco_plan_people pp
            JOIN pco_plans p ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
           WHERE pp.org_id = t.org_id AND pp.team_id = t.pco_id
             AND pp.person_id != ''
             AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
             AND p.sort_date >= ?)                              AS recentlyServed
       FROM pco_team_memberships m
       JOIN pco_teams t
         ON t.org_id = m.org_id AND t.pco_id = m.team_id
      WHERE m.org_id = ?
        AND m.person_id = ?
        AND m.archived_at IS NULL
        AND m.is_team_leader = 1
        AND t.archived_at IS NULL
        AND t.deleted_at IS NULL
      ORDER BY members DESC, t.name ASC`,
    )
    .all(cutoff, orgId, personId) as ShepherdDetailTeam[];

  // Build the flock: distinct people across all groups + teams this
  // shepherd leads, with the ministry context they share + lane tags +
  // a rough co-shepherd signal.
  const flockMap = new Map<
    string,
    {
      lanes: Set<"comm" | "serv">;
      contexts: string[];
      coShepherd: boolean;
    }
  >();
  for (const g of groupsLed) {
    const rows = db
      .prepare(
        `SELECT DISTINCT person_id FROM pco_group_memberships
           WHERE org_id = ? AND group_id = ? AND archived_at IS NULL`,
      )
      .all(orgId, g.id) as Array<{ person_id: string }>;
    // A "co-shepherd" exists if g has more than one leader.
    const hasCo = g.leaders > 1;
    for (const r of rows) {
      if (!r.person_id) continue;
      const e = flockMap.get(r.person_id) ?? {
        lanes: new Set<"comm" | "serv">(),
        contexts: [],
        coShepherd: false,
      };
      e.lanes.add("comm");
      if (g.name) e.contexts.push(g.name);
      if (hasCo) e.coShepherd = true;
      flockMap.set(r.person_id, e);
    }
  }
  for (const t of teamsLed) {
    const rows = db
      .prepare(
        `SELECT DISTINCT person_id FROM pco_team_memberships
           WHERE org_id = ? AND team_id = ? AND archived_at IS NULL
             AND person_id != ''`,
      )
      .all(orgId, t.id) as Array<{ person_id: string }>;
    const hasCo = t.leaders > 1;
    for (const r of rows) {
      const e = flockMap.get(r.person_id) ?? {
        lanes: new Set<"comm" | "serv">(),
        contexts: [],
        coShepherd: false,
      };
      e.lanes.add("serv");
      if (t.name) e.contexts.push(t.name);
      if (hasCo) e.coShepherd = true;
      flockMap.set(r.person_id, e);
    }
  }
  // Don't count the shepherd themselves.
  flockMap.delete(personId);

  // Decrypt names for every flock member in a single pass.
  const flockIds = Array.from(flockMap.keys());
  const flock: FlockMember[] = [];
  if (flockIds.length > 0) {
    const placeholders = flockIds.map(() => "?").join(",");
    const peopleRows = db
      .prepare(
        `SELECT pco_id, enc_pii, is_minor FROM pco_people
          WHERE org_id = ? AND pco_id IN (${placeholders})`,
      )
      .all(orgId, ...flockIds) as Array<{
      pco_id: string;
      enc_pii: string | null;
      is_minor: number;
    }>;
    const piiById = new Map<string, PIIBlob>();
    const minorById = new Map<string, boolean>();
    for (const p of peopleRows) {
      if (p.enc_pii) {
        const pii = decryptJson<PIIBlob>(p.enc_pii);
        if (pii) piiById.set(p.pco_id, pii);
      }
      minorById.set(p.pco_id, p.is_minor === 1);
    }
    for (const [pid, e] of flockMap.entries()) {
      const pii = piiById.get(pid);
      const f = pii?.first_name ?? null;
      const l = pii?.last_name ?? null;
      const name = [f, l].filter(Boolean).join(" ") || `(unknown #${pid})`;
      const inits =
        ((f?.[0] ?? "") + (l?.[0] ?? "")).toUpperCase() || "??";
      flock.push({
        personId: pid,
        fullName: name,
        initials: inits,
        lanes: Array.from(e.lanes),
        context: e.contexts[0] ?? null,
        hasCoShepherd: e.coShepherd,
        isMinor: minorById.get(pid) ?? false,
      });
    }
    flock.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  return {
    personId,
    fullName,
    initials,
    isMinor: personRow.is_minor === 1,
    isParent: personRow.is_parent === 1,
    birthYear: personRow.birth_year,
    membershipType: personRow.membership_type,
    groupsLed,
    teamsLed,
    flockSize: flockMap.size,
    flock,
  };
}
