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
