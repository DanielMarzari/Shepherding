import "server-only";
import { getDb } from "./db";
import {
  getExcludedCheckinEvents,
  getExcludedGroupTypes,
  getExcludedTeamPositions,
  getExcludedTeamTypes,
  getSyncSettings,
} from "./pco";

export interface ClassificationRationale {
  /** True when at least one un-blocked shepherding signal exists — i.e.
   *  the person is Shepherded and the activity signals below are just
   *  context (Shepherded already wins the priority order). */
  isShepherded: boolean;
  /** Things that ARE pushing the person toward Shepherded. */
  shepherdedReasons: string[];
  /** Things that could have shepherded them but were filtered out
   *  (excluded group type, excluded service type, archived team, etc.). */
  blockers: string[];
  /** What's pushing them to Active (forms / check-ins). */
  activitySignals: string[];
  /** Bare facts used to compute the classification — useful for
   *  debugging "why isn't this person showing up where I'd expect." */
  facts: Array<{ label: string; value: string }>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Explain why a person ended up with whatever classification they
 *  have. Reads exactly the same signals as populateShepherdedTempTable
 *  + the active/present buildWhere clauses, but returns plain English
 *  the user can audit on /people/[slug]. */
export function explainClassification(
  orgId: number,
  personId: string,
  activityMonths: number,
): ClassificationRationale {
  const db = getDb();
  const excludedGroups = new Set(getExcludedGroupTypes(orgId));
  const excludedTeams = new Set(getExcludedTeamTypes(orgId));
  const excludedPositions = new Set(getExcludedTeamPositions(orgId));
  const excludedEvents = new Set(getExcludedCheckinEvents(orgId));
  const cutoff = new Date(
    Date.now() - activityMonths * 30 * MS_PER_DAY,
  ).toISOString();

  const shepherdedReasons: string[] = [];
  const blockers: string[] = [];
  const activitySignals: string[] = [];
  const facts: Array<{ label: string; value: string }> = [];

  // Groups
  const groupRows = db
    .prepare(
      `SELECT
         g.pco_id  AS groupId,
         g.name    AS groupName,
         g.archived_at AS groupArchivedAt,
         g.group_type_id AS groupTypeId,
         t.name    AS typeName,
         m.role    AS role
       FROM pco_group_memberships m
       JOIN pco_groups g
         ON g.org_id = m.org_id AND g.pco_id = m.group_id
       LEFT JOIN pco_group_types t
         ON t.org_id = g.org_id AND t.pco_id = g.group_type_id
       WHERE m.org_id = ?
         AND m.person_id = ?
         AND m.archived_at IS NULL`,
    )
    .all(orgId, personId) as Array<{
    groupId: string;
    groupName: string | null;
    groupArchivedAt: string | null;
    groupTypeId: string | null;
    typeName: string | null;
    role: string | null;
  }>;
  for (const g of groupRows) {
    const gName = g.groupName ?? `Group #${g.groupId}`;
    const tName = g.typeName ?? "(no type)";
    if (g.groupArchivedAt) {
      blockers.push(`In group "${gName}" but the group is archived.`);
    } else if (g.groupTypeId && excludedGroups.has(g.groupTypeId)) {
      blockers.push(
        `In group "${gName}" but its type "${tName}" is excluded on /pco/filters.`,
      );
    } else {
      shepherdedReasons.push(`Active member of group "${gName}" (${tName}).`);
    }
  }

  // Teams
  const teamRows = db
    .prepare(
      `SELECT
         t.pco_id        AS teamId,
         t.name          AS teamName,
         t.archived_at   AS teamArchivedAt,
         t.deleted_at    AS teamDeletedAt,
         t.service_type_id AS serviceTypeId,
         st.name         AS serviceTypeName,
         m.position_id   AS positionId,
         m.position_name AS positionName,
         m.is_team_leader AS isLeader
       FROM pco_team_memberships m
       JOIN pco_teams t
         ON t.org_id = m.org_id AND t.pco_id = m.team_id
       LEFT JOIN pco_service_types st
         ON st.org_id = t.org_id AND st.pco_id = t.service_type_id
       WHERE m.org_id = ?
         AND m.person_id = ?
         AND m.archived_at IS NULL
         AND m.person_id != ''`,
    )
    .all(orgId, personId) as Array<{
    teamId: string;
    teamName: string | null;
    teamArchivedAt: string | null;
    teamDeletedAt: string | null;
    serviceTypeId: string | null;
    serviceTypeName: string | null;
    positionId: string | null;
    positionName: string | null;
    isLeader: number;
  }>;
  // Group team rows by team (a person can hold many positions).
  const teamMap = new Map<string, typeof teamRows>();
  for (const r of teamRows) {
    const arr = teamMap.get(r.teamId) ?? [];
    arr.push(r);
    teamMap.set(r.teamId, arr);
  }
  for (const [teamId, rows] of teamMap.entries()) {
    const r0 = rows[0];
    const tName = r0.teamName ?? `Team #${teamId}`;
    const stName = r0.serviceTypeName ?? "(no service type)";
    if (r0.teamArchivedAt || r0.teamDeletedAt) {
      blockers.push(`On team "${tName}" but the team is archived.`);
      continue;
    }
    if (r0.serviceTypeId && excludedTeams.has(r0.serviceTypeId)) {
      blockers.push(
        `On team "${tName}" but its service type "${stName}" is excluded.`,
      );
      continue;
    }
    // All-positions-excluded check.
    const liveRows = rows.filter(
      (r) => !r.positionId || !excludedPositions.has(r.positionId),
    );
    if (liveRows.length === 0) {
      const posNames = rows
        .map((r) => r.positionName ?? "(unnamed position)")
        .join(", ");
      blockers.push(
        `On team "${tName}" but every position they hold (${posNames}) is excluded.`,
      );
      continue;
    }
    const posSummary = liveRows
      .map((r) => r.positionName ?? "(unnamed position)")
      .join(", ");
    shepherdedReasons.push(
      `Active roster on team "${tName}" (${stName}) as ${posSummary}.`,
    );
  }

  // Check-ins
  const checkinRow = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         MAX(pco_created_at) AS latest,
         SUM(CASE WHEN event_id IN (
           SELECT pco_id FROM pco_checkin_events WHERE org_id = ?
         ) THEN 1 ELSE 0 END) AS toAnyEvent
       FROM pco_check_ins
       WHERE org_id = ? AND person_id = ?`,
    )
    .get(orgId, orgId, personId) as {
    total: number;
    latest: string | null;
    toAnyEvent: number | null;
  };
  const personRow = db
    .prepare(
      `SELECT is_minor, last_check_in_at, last_form_submission_at, pco_updated_at
         FROM pco_people WHERE org_id = ? AND pco_id = ?`,
    )
    .get(orgId, personId) as
    | {
        is_minor: number;
        last_check_in_at: string | null;
        last_form_submission_at: string | null;
        pco_updated_at: string | null;
      }
    | undefined;
  const isMinor = personRow?.is_minor === 1;

  if (checkinRow.total > 0) {
    const settings = getSyncSettings(orgId);
    const windowCutoff = new Date(
      Date.now() -
        settings.shepherdedCheckinWindowMonths * 30 * MS_PER_DAY,
    ).toISOString();
    // Default: every check-in event counts; admin's excluded list pulls
    // out non-kid events.
    const excludeClause =
      excludedEvents.size === 0
        ? ""
        : `AND event_id NOT IN (${Array.from(excludedEvents)
            .map(() => "?")
            .join(",")})`;
    const args: Array<string | number> = [
      windowCutoff,
      windowCutoff,
      orgId,
      personId,
      ...excludedEvents,
    ];
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS allTime,
           SUM(CASE WHEN pco_created_at >= ? THEN 1 ELSE 0 END) AS inWindow,
           SUM(CASE
                 WHEN pco_created_at >= ?
                  AND checked_in_by_id IS NOT NULL
                  AND checked_in_by_id != person_id
                 THEN 1 ELSE 0 END) AS dependentInWindow
         FROM pco_check_ins
         WHERE org_id = ?
           AND person_id = ?
           ${excludeClause}`,
      )
      .get(...args) as {
      allTime: number;
      inWindow: number | null;
      dependentInWindow: number | null;
    };
    const inWindow = row.inWindow ?? 0;
    const dependentInWindow = row.dependentInWindow ?? 0;
    const min = settings.shepherdedCheckinMinEvents;
    if (row.allTime > 0) {
      const meetsCount = inWindow >= min;
      const dependentSignal = isMinor || dependentInWindow > 0;
      if (meetsCount && dependentSignal) {
        const reason = isMinor
          ? "they're a minor"
          : `${dependentInWindow} of those check-ins were done by someone else (dependent signal)`;
        shepherdedReasons.push(
          `${inWindow} kid-event check-in${inWindow === 1 ? "" : "s"} in the last ${settings.shepherdedCheckinWindowMonths}mo (≥ ${min}) — ${reason}.`,
        );
      } else if (!meetsCount) {
        const outside = row.allTime - inWindow;
        blockers.push(
          `Only ${inWindow} kid-event check-in${inWindow === 1 ? "" : "s"} in the last ${settings.shepherdedCheckinWindowMonths}mo — needs ≥ ${min} to count as Shepherded.${outside > 0 ? ` ${outside} earlier check-in${outside === 1 ? "" : "s"} sit outside the window.` : ""}`,
        );
      } else {
        blockers.push(
          `${inWindow} kid-event check-in${inWindow === 1 ? "" : "s"} in the window, but they always self-check-in (no parent / leader on record). The rule treats those as Active, not Shepherded.`,
        );
      }
    }
  }

  // Activity signals
  if (
    personRow?.last_form_submission_at &&
    personRow.last_form_submission_at >= cutoff
  ) {
    activitySignals.push(
      `Last form submission ${formatAgo(personRow.last_form_submission_at)} (within ${activityMonths}mo).`,
    );
  }
  if (
    personRow?.last_check_in_at &&
    personRow.last_check_in_at >= cutoff
  ) {
    activitySignals.push(
      `Last check-in role ${formatAgo(personRow.last_check_in_at)} (within ${activityMonths}mo).`,
    );
  }
  // The pco_updated_at fallback only decides Present vs Inactive among
  // people who AREN'T shepherded. For a shepherded person it's noise —
  // Shepherded already wins — so don't claim it "drives Present".
  if (
    personRow?.pco_updated_at &&
    personRow.pco_updated_at >= cutoff &&
    activitySignals.length === 0 &&
    shepherdedReasons.length === 0
  ) {
    activitySignals.push(
      `PCO record edited ${formatAgo(personRow.pco_updated_at)} — drives "Present", not "Active".`,
    );
  }

  facts.push({ label: "is_minor", value: isMinor ? "1" : "0" });
  facts.push({
    label: "check-ins on file",
    value: checkinRow.total.toLocaleString(),
  });
  facts.push({
    label: "last check-in",
    value: checkinRow.latest ? formatAgo(checkinRow.latest) : "—",
  });
  facts.push({
    label: "active group memberships",
    value: String(groupRows.length),
  });
  facts.push({
    label: "active team memberships",
    value: String(teamMap.size),
  });

  return {
    isShepherded: shepherdedReasons.length > 0,
    shepherdedReasons,
    blockers,
    activitySignals,
    facts,
  };
}

function formatAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}
