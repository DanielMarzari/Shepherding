import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import type { QueryParams, QueryResult } from "./builder";
import { getFallingThroughCracks, getRecentMovement, getShepherdWorkload } from "./dashboard-read";
import { listShepherds } from "./shepherds-read";
import { getLeaderOverseersBatch } from "./shepherd-graph";
import { listLeadPastorIds, listShepherdTeamIds } from "./assignments-read";
import { getListByName } from "./lists-read";
import { getShepherdTeamBreakdown } from "./shepherd-team-read";
import { listDuplicatePairs } from "./audit-read";

const SHEPHERD_TEAM_LIST = "REFERENCE - Shepherd Team";

/** Enriched shepherd rows shared by the directory table + the overview stat:
 *  each leader with their led-unit counts, their shepherd-team overseer(s),
 *  and a status (needs mapping / lead pastor / overseen) — the exact logic
 *  the hand-coded /shepherds page uses. */
function shepherdRows(orgId: number) {
  const shepherds = listShepherds(orgId);
  const leadPastorIds = new Set(listLeadPastorIds(orgId));
  const teamIds = new Set(listShepherdTeamIds(orgId));
  const overseersByPerson = getLeaderOverseersBatch(orgId, shepherds.map((s) => s.personId));
  const rows = shepherds.map((s) => {
    const seen = new Map<string, string>();
    for (const link of overseersByPerson.get(s.personId) ?? []) {
      // Only oversight FROM the shepherd team counts here.
      if (!teamIds.has(link.shepherd.personId)) continue;
      if (!seen.has(link.shepherd.personId)) seen.set(link.shepherd.personId, link.shepherd.fullName);
    }
    const overseers = [...seen.values()];
    const isLeadPastor = leadPastorIds.has(s.personId);
    const needsMapping = overseers.length === 0 && !isLeadPastor;
    return {
      fullName: s.fullName,
      groupsLed: s.groupsLed.length,
      teamsLed: s.teamsLed.length,
      overseers,
      status: needsMapping ? "Needs mapping" : isLeadPastor ? "Lead pastor" : "Overseen",
      tier: needsMapping ? 0 : isLeadPastor ? 1 : 2,
    };
  });
  // Action items first, then the apex lead pastor, then the overseen — name within tier.
  rows.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.fullName.localeCompare(b.fullName)));
  return rows;
}

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

  people_directory: (orgId, params) => {
    // Optional :classification filter (from a tabs/dropdown filter). Empty =
    // everyone except inactive; a value = exactly that classification.
    const cls = (params.classification ?? "").trim().toLowerCase();
    const clsArg = ["shepherded", "active", "present", "inactive"].includes(cls) ? cls : "";
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
            AND (p.membership_type IS NULL OR lower(p.membership_type) NOT LIKE '%system use%')
            AND ( (? = '' AND COALESCE(pa.classification,'inactive') != 'inactive')
                  OR COALESCE(pa.classification,'inactive') = ? )
          ORDER BY CASE COALESCE(pa.classification,'inactive')
                     WHEN 'shepherded' THEN 0 WHEN 'active' THEN 1 WHEN 'present' THEN 2 ELSE 3 END
          LIMIT 1000`,
      )
      .all(orgId, clsArg, clsArg) as Array<{ enc: string | null; cls: string; mt: string | null; gc: number; tc: number }>;
    return R(
      ["Name", "Classification", "Membership", "Groups", "Teams"],
      rows.map((r) => [nameOf(r.enc), r.cls, r.mt ?? "—", r.gc, r.tc]),
    );
  },

  shepherds_directory: (orgId) => {
    const rows = shepherdRows(orgId);
    return R(
      ["Shepherd", "Status", "Groups led", "Teams led", "Overseen by"],
      rows.map((r) => [r.fullName, r.status, r.groupsLed, r.teamsLed, r.overseers.join(", ") || "—"]),
    );
  },

  // Single row of the three /shepherds headline counts, for a list-format stat.
  shepherds_overview: (orgId) => {
    const rows = shepherdRows(orgId);
    // Match the hand-coded page: "overseen" = anyone with ≥1 overseer (even
    // the lead pastor if mapped); "needs mapping" = the action-item rows.
    const overseen = rows.filter((r) => r.overseers.length > 0).length;
    const needsMapping = rows.filter((r) => r.status === "Needs mapping").length;
    return R(["Shepherds", "Overseen", "Needs mapping"], [[rows.length, overseen, needsMapping]]);
  },

  shepherd_team_directory: (orgId) => {
    const list = getListByName(orgId, SHEPHERD_TEAM_LIST);
    const cols = ["Shepherd", "Membership", "Staff", "Vol leaders", "Congregants", "Care", "Total reach"];
    if (!list) return R(cols, []);
    const breakdown = getShepherdTeamBreakdown(orgId, list.members.map((m) => m.personId));
    const rows = list.members.map((m) => {
      const b = breakdown.get(m.personId);
      return [
        m.fullName,
        m.membershipType ?? "—",
        b?.staffDirect ?? 0,
        b?.volunteerLeaders ?? 0,
        b?.congregants ?? 0,
        b?.careNonShepherded ?? 0,
        b?.totalReach ?? 0,
      ];
    });
    rows.sort((a, b) => Number(b[6]) - Number(a[6]));
    return R(cols, rows);
  },

  // Likely-duplicate people. Optional :confidence param (high/low) narrows it,
  // matching the /audit/duplicates confidence chips.
  duplicate_pairs: (orgId, params) => {
    const want = (params.confidence ?? "").trim().toLowerCase();
    const conf = want === "high" || want === "low" ? want : "";
    const label = (p: { fullName: string; inactive: boolean }) => (p.inactive ? `${p.fullName} (inactive)` : p.fullName);
    const pairs = listDuplicatePairs(orgId).filter((p) => !conf || p.confidence === conf);
    return R(
      ["Person A", "Person B", "Confidence", "Signals", "Returning?"],
      pairs.map((p) => [label(p.a), label(p.b), p.confidence, p.reasons.join(", ") || "—", p.oneActiveOneInactive ? "Yes" : ""]),
    );
  },

  // Single row of the /audit/duplicates headline counts, for a list-format stat.
  duplicate_overview: (orgId) => {
    const all = listDuplicatePairs(orgId);
    return R(
      ["Pairs", "High", "Low", "Returning"],
      [[
        all.length,
        all.filter((p) => p.confidence === "high").length,
        all.filter((p) => p.confidence === "low").length,
        all.filter((p) => p.oneActiveOneInactive).length,
      ]],
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
