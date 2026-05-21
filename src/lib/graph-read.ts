import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { getSyncSettings } from "./pco";
import { populateShepherdedTempTable } from "./people-read";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export type GraphClass = "shepherded" | "active" | "present";

export interface GraphNode {
  id: string;
  name: string;
  cls: GraphClass;
}

/** [sourceIndex, targetIndex, kind] — kind 0 = shepherded (drawn as the
 *  prominent edge), 1 = active (grey), 2 = present (faint). */
export type GraphEdge = [number, number, 0 | 1 | 2];

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Groups/teams skipped from edge-drawing because they're far too
   *  large to be a real shepherding context (mailing-list style). */
  skippedLargeContexts: number;
}

// Above this headcount a "group" or "team" is almost certainly an
// everyone / newsletter list, not a shepherding context — its star of
// edges would just be noise, so we skip it.
const MAX_CONTEXT_SIZE = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build the whole-church relationship graph: one node per non-inactive
 *  person, one edge per shepherding link (group / team leadership and
 *  care-roster assignments). Edge kind is the classification of the
 *  person being shepherded, so the client can colour shepherded links
 *  differently from active ones. */
export function buildRelationshipGraph(orgId: number): GraphData {
  const db = getDb();
  populateShepherdedTempTable(orgId);
  const months = getSyncSettings(orgId).activityMonths;
  const cutoff = new Date(Date.now() - months * 30 * DAY_MS).toISOString();

  const rows = db
    .prepare(
      `SELECT p.pco_id AS id, p.enc_pii AS encPii,
         CASE
           WHEN s.person_id IS NOT NULL THEN 'shepherded'
           WHEN ((p.last_form_submission_at IS NOT NULL
                   AND p.last_form_submission_at >= ?)
                 OR (p.last_check_in_at IS NOT NULL
                   AND p.last_check_in_at >= ?)) THEN 'active'
           WHEN (p.pco_updated_at IS NOT NULL
                  AND p.pco_updated_at >= ?) THEN 'present'
           ELSE 'inactive'
         END AS cls
       FROM pco_people p
       LEFT JOIN temp.shep_set s ON s.person_id = p.pco_id
      WHERE p.org_id = ?`,
    )
    .all(cutoff, cutoff, cutoff, orgId) as Array<{
    id: string;
    encPii: string | null;
    cls: string;
  }>;

  const idx = new Map<string, number>();
  const clsOf = new Map<string, GraphClass>();
  const nodes: GraphNode[] = [];
  for (const r of rows) {
    if (r.cls === "inactive") continue;
    const cls = r.cls as GraphClass;
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const name =
      [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") ||
      `(unknown #${r.id})`;
    idx.set(r.id, nodes.length);
    clsOf.set(r.id, cls);
    nodes.push({ id: r.id, name, cls });
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  function addEdge(srcId: string, tgtId: string) {
    const si = idx.get(srcId);
    const ti = idx.get(tgtId);
    if (si === undefined || ti === undefined || si === ti) return;
    const key = si < ti ? `${si}.${ti}` : `${ti}.${si}`;
    if (seen.has(key)) return;
    seen.add(key);
    const c = clsOf.get(tgtId);
    const kind: 0 | 1 | 2 =
      c === "shepherded" ? 0 : c === "active" ? 1 : 2;
    edges.push([si, ti, kind]);
  }

  let skipped = 0;

  // Group leadership: each leader -> each non-leader member.
  const groupRows = db
    .prepare(
      `SELECT m.group_id AS gid, m.person_id AS pid,
              CASE WHEN lower(coalesce(m.role, '')) LIKE '%leader%'
                   THEN 1 ELSE 0 END AS isLeader
         FROM pco_group_memberships m
         JOIN pco_groups g
           ON g.org_id = m.org_id AND g.pco_id = m.group_id
        WHERE m.org_id = ? AND m.archived_at IS NULL
          AND g.archived_at IS NULL`,
    )
    .all(orgId) as Array<{ gid: string; pid: string; isLeader: number }>;
  const byGroup = new Map<string, { leaders: string[]; members: string[] }>();
  for (const r of groupRows) {
    const e = byGroup.get(r.gid) ?? { leaders: [], members: [] };
    if (r.isLeader) e.leaders.push(r.pid);
    else e.members.push(r.pid);
    byGroup.set(r.gid, e);
  }
  for (const e of byGroup.values()) {
    if (e.leaders.length + e.members.length > MAX_CONTEXT_SIZE) {
      skipped++;
      continue;
    }
    for (const leader of e.leaders) {
      for (const member of e.members) addEdge(leader, member);
    }
  }

  // Team leadership: each team leader -> each non-leader member.
  const teamRows = db
    .prepare(
      `SELECT m.team_id AS tid, m.person_id AS pid, m.is_team_leader AS isLeader
         FROM pco_team_memberships m
         JOIN pco_teams t
           ON t.org_id = m.org_id AND t.pco_id = m.team_id
        WHERE m.org_id = ? AND m.archived_at IS NULL AND m.person_id != ''
          AND t.archived_at IS NULL AND t.deleted_at IS NULL`,
    )
    .all(orgId) as Array<{ tid: string; pid: string; isLeader: number }>;
  const byTeam = new Map<string, { leaders: string[]; members: string[] }>();
  for (const r of teamRows) {
    const e = byTeam.get(r.tid) ?? { leaders: [], members: [] };
    if (r.isLeader) e.leaders.push(r.pid);
    else e.members.push(r.pid);
    byTeam.set(r.tid, e);
  }
  for (const e of byTeam.values()) {
    if (e.leaders.length + e.members.length > MAX_CONTEXT_SIZE) {
      skipped++;
      continue;
    }
    for (const leader of e.leaders) {
      for (const member of e.members) addEdge(leader, member);
    }
  }

  // Care roster — a manual shepherd -> person link.
  for (const r of db
    .prepare(
      `SELECT shepherd_person_id AS s, person_id AS p
         FROM care_assignments WHERE org_id = ?`,
    )
    .all(orgId) as Array<{ s: string; p: string }>) {
    addEdge(r.s, r.p);
  }

  return { nodes, edges, skippedLargeContexts: skipped };
}
