import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { getExcludedMembershipTypes } from "./pco";
import { SHEPHERD_TEAM_LIST_NAME } from "./assignments-read";

interface PII { first_name?: string | null; last_name?: string | null }
export type IntakeSource = "know" | "unknown";

function nameMap(orgId: number, ids: string[]): Map<string, string> {
  const m = new Map<string, string>();
  if (!ids.length) return m;
  const rows = getDb()
    .prepare(`SELECT pco_id, enc_pii FROM pco_people WHERE org_id = ? AND pco_id IN (${ids.map(() => "?").join(",")})`)
    .all(orgId, ...ids) as Array<{ pco_id: string; enc_pii: string | null }>;
  for (const r of rows) {
    const p = r.enc_pii ? decryptJson<PII>(r.enc_pii) : null;
    m.set(r.pco_id, [p?.first_name, p?.last_name].filter(Boolean).join(" ") || `#${r.pco_id}`);
  }
  return m;
}

function shepherdTeamSet(orgId: number): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT m.person_id AS pid FROM pco_list_memberships m
         JOIN pco_lists l ON l.org_id = m.org_id AND l.pco_id = m.list_id
        WHERE m.org_id = ? AND l.name = ?`,
    )
    .all(orgId, SHEPHERD_TEAM_LIST_NAME) as Array<{ pid: string }>;
  return new Set(rows.map((r) => r.pid));
}

export interface GraphNode {
  id: string;
  name: string;
  onTeam: boolean;
  degree: number;
  /** Belongs to the classification pool this graph covers (Known / Unknown) —
   *  false for markers who aren't themselves in the pool. */
  inPool: boolean;
}
export interface GraphData { nodes: GraphNode[]; links: Array<{ source: string; target: string }> }

/** The who-knows-who web for one source. Nodes = EVERYONE in the source's
 *  classification pool (so un-known people show as an unconnected field) plus
 *  anyone who marked someone; shepherd-team members are flagged for coloring. */
export function getIntakeGraph(orgId: number, source: IntakeSource): GraphData {
  const db = getDb();
  // /know works the Known pool, /know/unknown the Unknown one.
  const cls = source === "know" ? "known" : "unknown";
  const excludedMem = getExcludedMembershipTypes(orgId);
  const memClause = excludedMem.length
    ? `AND (p.membership_type IS NULL OR p.membership_type NOT IN (${excludedMem.map(() => "?").join(",")}))`
    : "";
  const pool = db
    .prepare(
      `SELECT pa.person_id AS pid FROM person_activity pa
         JOIN pco_people p ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
        WHERE pa.org_id = ? AND pa.classification = ?
          AND p.is_minor = 0
          AND lower(coalesce(p.status,'')) != 'inactive'
          AND p.inactivated_at IS NULL ${memClause}`,
    )
    .all(orgId, cls, ...excludedMem) as Array<{ pid: string }>;
  const poolSet = new Set(pool.map((r) => r.pid));

  const marks = db
    .prepare("SELECT shepherd_person_id AS s, person_id AS p FROM shepherd_known_people WHERE org_id = ? AND source = ?")
    .all(orgId, source) as Array<{ s: string; p: string }>;
  const ids = new Set<string>(poolSet);
  const degree = new Map<string, number>();
  for (const m of marks) {
    ids.add(m.s); ids.add(m.p);
    degree.set(m.s, (degree.get(m.s) ?? 0) + 1);
    degree.set(m.p, (degree.get(m.p) ?? 0) + 1);
  }
  const names = nameMap(orgId, [...ids]);
  const team = shepherdTeamSet(orgId);
  const nodes = [...ids].map((id) => ({
    id,
    name: names.get(id) ?? `#${id}`,
    onTeam: team.has(id),
    degree: degree.get(id) ?? 0,
    inPool: poolSet.has(id),
  }));
  return { nodes, links: marks.map((m) => ({ source: m.s, target: m.p })) };
}

export interface IntakeCoverage {
  knownTotal: number; knownMarked: number; knownPct: number | null;
  unknownTotal: number; unknownMarked: number; unknownPct: number | null;
  knowMarks: number; knowMarkers: number; unknownMarks: number; unknownMarkers: number;
}

export function getIntakeCoverage(orgId: number): IntakeCoverage {
  const db = getDb();
  const n = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const knownTotal = n("SELECT COUNT(*) n FROM person_activity WHERE org_id = ? AND classification = 'known'", orgId);
  const unknownTotal = n("SELECT COUNT(*) n FROM person_activity WHERE org_id = ? AND classification = 'unknown'", orgId);
  const markedOf = (source: string, cls: string) => n(
    `SELECT COUNT(DISTINCT k.person_id) n FROM shepherd_known_people k
       JOIN person_activity pa ON pa.org_id = k.org_id AND pa.person_id = k.person_id
      WHERE k.org_id = ? AND k.source = ? AND pa.classification = ?`,
    orgId, source, cls);
  // These two compared classification to 'active' and 'present' until
  // 2026-10-27, so both coverage figures read 0% once the bands were renamed.
  const knownMarked = markedOf("know", "known");
  const unknownMarked = markedOf("unknown", "unknown");
  const marks = (source: string) => n("SELECT COUNT(*) n FROM shepherd_known_people WHERE org_id = ? AND source = ?", orgId, source);
  const markers = (source: string) => n("SELECT COUNT(DISTINCT shepherd_person_id) n FROM shepherd_known_people WHERE org_id = ? AND source = ?", orgId, source);
  return {
    knownTotal, knownMarked, knownPct: knownTotal ? knownMarked / knownTotal : null,
    unknownTotal, unknownMarked, unknownPct: unknownTotal ? unknownMarked / unknownTotal : null,
    knowMarks: marks("know"), knowMarkers: markers("know"),
    unknownMarks: marks("unknown"), unknownMarkers: markers("unknown"),
  };
}

/** Who has flagged the most people, per source. */
export function getTopMarkers(orgId: number, source: IntakeSource, limit = 10): Array<{ name: string; count: number }> {
  const rows = getDb()
    .prepare("SELECT shepherd_person_id AS pid, COUNT(*) AS c FROM shepherd_known_people WHERE org_id = ? AND source = ? GROUP BY shepherd_person_id ORDER BY c DESC LIMIT ?")
    .all(orgId, source, limit) as Array<{ pid: string; c: number }>;
  const names = nameMap(orgId, rows.map((r) => r.pid));
  return rows.map((r) => ({ name: names.get(r.pid) ?? `#${r.pid}`, count: r.c }));
}
