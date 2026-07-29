import "server-only";
import { cache } from "react";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import type { LinkCardPerson, LinkCardTag, QueryParams, QueryResult } from "./builder";
import { getFallingThroughCracks, getRecentMovement, getShepherdWorkload } from "./dashboard-read";
import { listShepherds } from "./shepherds-read";
import { getLeaderOverseersBatch } from "./shepherd-graph";
import { listAssignments, listLeadPastorIds, listShepherdTeamIds } from "./assignments-read";
import { TARGET_KIND_LABELS } from "./assignments-types";
import { getListByName } from "./lists-read";
import { getShepherdTeamBreakdown } from "./shepherd-team-read";
import { listDuplicatePairs } from "./audit-read";

const SHEPHERD_TEAM_LIST = "REFERENCE - Shepherd Team";

/** Enriched shepherd rows shared by the directory table + the overview stats:
 *  each leader with the group/team names they lead, their shepherd-team
 *  overseer(s), and a status (needs mapping / lead pastor / overseen) — the
 *  exact logic the hand-coded /shepherds page uses. Wrapped in React.cache so
 *  the several stat cards + the table that read it during one render share a
 *  single (graph-heavy) computation. */
const shepherdRows = cache((orgId: number) => {
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
      groupsLed: s.groupsLed.map((g) => g.name ?? "(unnamed group)"),
      teamsLed: s.teamsLed.map((t) => t.name ?? "(unnamed team)"),
      overseers,
      status: needsMapping ? "Needs mapping" : isLeadPastor ? "Lead pastor" : "Overseen",
      tier: needsMapping ? 0 : isLeadPastor ? 1 : 2,
    };
  });
  // Action items first, then the apex lead pastor, then the overseen — name within tier.
  rows.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.fullName.localeCompare(b.fullName)));
  return rows;
});

/** Duplicate pairs, cached per render so the overview stats + the cards share
 *  one computation. */
const dupPairs = cache((orgId: number) => listDuplicatePairs(orgId));

/** Shepherd-team assignments grouped by shepherd person id (cached). */
const assignmentsByShepherd = cache((orgId: number) => {
  const map = new Map<string, string[]>();
  for (const a of listAssignments(orgId)) {
    const chip = `${TARGET_KIND_LABELS[a.targetKind]}: ${a.targetName}`;
    (map.get(a.shepherdPersonId) ?? map.set(a.shepherdPersonId, []).get(a.shepherdPersonId)!).push(chip);
  }
  return map;
});

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

  // Newline-joined name lists in Groups led / Teams led / Overseen by so the
  // table can render them as chips (mark those columns as chip columns).
  shepherds_directory: (orgId) => {
    const rows = shepherdRows(orgId);
    return R(
      ["Shepherd", "Status", "Groups led", "Teams led", "Overseen by"],
      rows.map((r) => [r.fullName, r.status, r.groupsLed.join("\n"), r.teamsLed.join("\n"), r.overseers.join("\n")]),
    );
  },

  // The three /shepherds headline counts in one row; three stat cards read
  // columns 0/1/2 via valueColumn (cached, so the graph runs once).
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
    const cols = ["Shepherd", "Membership", "Assignments", "Staff", "Vol leaders", "Congregants", "Care", "Total reach"];
    if (!list) return R(cols, []);
    const breakdown = getShepherdTeamBreakdown(orgId, list.members.map((m) => m.personId));
    const assigns = assignmentsByShepherd(orgId);
    const rows = list.members.map((m) => {
      const b = breakdown.get(m.personId);
      return [
        m.fullName,
        m.membershipType ?? "—",
        (assigns.get(m.personId) ?? []).join("\n"),
        b?.staffDirect ?? 0,
        b?.volunteerLeaders ?? 0,
        b?.congregants ?? 0,
        b?.careNonShepherded ?? 0,
        b?.totalReach ?? 0,
      ];
    });
    rows.sort((a, b) => Number(b[7]) - Number(a[7]));
    return R(cols, rows);
  },

  // Likely-duplicate people as PCO-link cards: each row is a pair (both people
  // link to PCO), the matching signals as the note, and confidence / returning
  // as tags. Optional :confidence param (high/low) narrows it.
  duplicate_pairs: (orgId, params) => {
    const want = (params.confidence ?? "").trim().toLowerCase();
    const conf = want === "high" || want === "low" ? want : "";
    const person = (p: { pcoId: string; fullName: string; initials: string; inactive: boolean }): LinkCardPerson => ({
      name: p.fullName,
      pcoId: p.pcoId,
      initials: p.initials,
      badge: p.inactive ? "inactive" : null,
    });
    const pairs = dupPairs(orgId).filter((p) => !conf || p.confidence === conf);
    return R(
      ["People", "Signals", "Tags"],
      pairs.map((p) => {
        const tags: LinkCardTag[] = [
          { label: p.confidence === "high" ? "high confidence" : "low confidence", tone: p.confidence === "high" ? "warning" : "low" },
        ];
        if (p.oneActiveOneInactive) tags.push({ label: "may be returning", tone: "highlight" });
        return [[person(p.a), person(p.b)], p.reasons.join("\n"), tags];
      }),
    );
  },

  // The /audit/duplicates headline counts in one row; stat cards read columns
  // 0/1/2/3 via valueColumn (cached).
  duplicate_overview: (orgId) => {
    const all = dupPairs(orgId);
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
