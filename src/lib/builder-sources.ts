import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import type { QueryParams, QueryResult } from "./builder";
import { getFallingThroughCracks, getRecentMovement, getShepherdWorkload } from "./dashboard-read";

// Curated, server-side data sources for builder blocks. Unlike raw SQL blocks
// (which run on a read-only connection that can't decrypt), these run in TS and
// may decrypt PII or call existing analytics. A block opts in via config.source;
// the render path calls runSource() instead of the SQL engine. Keyed by the ids
// in builder-source-meta.ts (client-safe metadata for the editor).

interface PII { first_name?: string | null; last_name?: string | null }
const nameOf = (enc: string | null): string => {
  const p = enc ? decryptJson<PII>(enc) : null;
  return [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "—";
};
const R = (columns: string[], rows: unknown[][]): QueryResult => ({ columns, rows, truncated: rows.length >= 1000 });

type SourceFn = (orgId: number, params: QueryParams) => QueryResult;

const SOURCES: Record<string, SourceFn> = {
  falling_through_cracks: (orgId) => {
    const list = getFallingThroughCracks(orgId, 50);
    return R(
      ["Person", "Context", "Last touch", "Days silent"],
      list.map((p) => [p.fullName, p.context, p.lastTouchAt ? p.lastTouchAt.slice(0, 10) : null, p.daysSilent]),
    );
  },

  recent_movement: (orgId) => {
    const ev = getRecentMovement(orgId, 14, 50);
    return R(["When", "What"], ev.map((m) => [m.day, m.text]));
  },

  shepherd_workload: (orgId) => {
    const top = getShepherdWorkload(orgId, 25);
    return R(["Shepherd", "Flock", "Units led"], top.map((s) => [s.fullName, s.flockSize, s.unitsLed]));
  },

  people_directory: (orgId) => {
    const rows = getDb()
      .prepare(
        `SELECT p.enc_pii AS enc,
                COALESCE(pa.classification, 'inactive') AS cls,
                p.membership_type AS mt,
                COALESCE(pa.active_group_count, 0) AS gc,
                COALESCE(pa.active_team_count, 0) AS tc
           FROM pco_people p
           LEFT JOIN person_activity pa ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
          WHERE p.org_id = ? AND p.is_minor = 0
            AND lower(coalesce(p.status,'')) != 'inactive' AND p.inactivated_at IS NULL
            AND (p.membership_type IS NULL OR lower(p.membership_type) NOT LIKE '%system use%')
          ORDER BY CASE COALESCE(pa.classification,'inactive')
                     WHEN 'shepherded' THEN 0 WHEN 'active' THEN 1 WHEN 'present' THEN 2 ELSE 3 END
          LIMIT 1000`,
      )
      .all(orgId) as Array<{ enc: string | null; cls: string; mt: string | null; gc: number; tc: number }>;
    return R(
      ["Name", "Classification", "Membership", "Groups", "Teams"],
      rows.map((r) => [nameOf(r.enc), r.cls, r.mt ?? "—", r.gc, r.tc]),
    );
  },

  staff_directory: (orgId) => {
    const rows = getDb()
      .prepare(
        `SELECT p.enc_pii AS enc, p.membership_type AS mt, COALESCE(pa.classification,'inactive') AS cls
           FROM pco_list_memberships lm
           JOIN pco_lists l ON l.org_id = lm.org_id AND l.pco_id = lm.list_id
           JOIN pco_people p ON p.org_id = lm.org_id AND p.pco_id = lm.person_id
           LEFT JOIN person_activity pa ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
          WHERE lm.org_id = ? AND l.name = 'REFERENCE - Church Staff'
          ORDER BY p.membership_type, p.pco_id`,
      )
      .all(orgId) as Array<{ enc: string | null; mt: string | null; cls: string }>;
    return R(["Name", "Membership", "Engagement"], rows.map((r) => [nameOf(r.enc), r.mt ?? "—", r.cls]));
  },
};

/** Run a named source, returning a QueryResult (columns/rows) like the SQL engine. */
export function runSource(orgId: number, id: string, params?: QueryParams): QueryResult {
  const fn = SOURCES[id];
  if (!fn) return { columns: [], rows: [], truncated: false, error: `Unknown data source: ${id}` };
  try {
    return fn(orgId, params ?? {});
  } catch (e) {
    return { columns: [], rows: [], truncated: false, error: e instanceof Error ? e.message : "Data source failed." };
  }
}
