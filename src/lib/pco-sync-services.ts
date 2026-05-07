import "server-only";
import { getDb } from "./db";
import { PCOClient, type PCOResource } from "./pco-client";

/** PCO Services / Teams sync — service_types, teams, team_positions,
 *  team memberships (the standing roster), plans, and per-plan-per-person
 *  serving records. Drives the Serve lane and the Teams workspace. */

export interface ServicesSyncResult {
  serviceTypes: { fetched: number; upserted: number };
  teams: { fetched: number; upserted: number };
  teamPositions: { fetched: number; upserted: number };
  teamMemberships: { fetched: number; upserted: number };
  plans: { fetched: number; upserted: number };
  planPeople: { fetched: number; upserted: number };
}

export async function syncServicesAll(
  client: PCOClient,
  orgId: number,
  thresholdMonths: number,
): Promise<ServicesSyncResult> {
  const result: ServicesSyncResult = {
    serviceTypes: { fetched: 0, upserted: 0 },
    teams: { fetched: 0, upserted: 0 },
    teamPositions: { fetched: 0, upserted: 0 },
    teamMemberships: { fetched: 0, upserted: 0 },
    plans: { fetched: 0, upserted: 0 },
    planPeople: { fetched: 0, upserted: 0 },
  };

  // 1) Service types — small list of "Sunday Services", "Special Services", etc.
  for await (const { page } of client.paginate<PCOResource>(
    "/services/v2/service_types?per_page=100",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const st of arr) {
      result.serviceTypes.fetched++;
      const a = (st.attributes ?? {}) as Record<string, unknown>;
      upsertServiceType(orgId, {
        pcoId: st.id,
        name: (a.name as string | undefined) ?? null,
        pcoCreatedAt: (a.created_at as string | undefined) ?? null,
        pcoUpdatedAt: (a.updated_at as string | undefined) ?? null,
        archivedAt: (a.archived_at as string | undefined) ?? null,
      });
      result.serviceTypes.upserted++;
    }
  }

  // 2) Teams — under service types. Pull all in one query with the
  //    service_type relationship, since not too many.
  const teamRecords: PCOResource[] = [];
  for await (const { page } of client.paginate<PCOResource>(
    "/services/v2/teams?per_page=100&include=service_type",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    teamRecords.push(...arr);
  }
  for (const t of teamRecords) {
    result.teams.fetched++;
    const a = (t.attributes ?? {}) as Record<string, unknown>;
    const rels = t.relationships ?? {};
    const stRel = rels.service_type?.data;
    const stId = !Array.isArray(stRel) && stRel ? stRel.id : null;
    upsertTeam(orgId, {
      pcoId: t.id,
      name: (a.name as string | undefined) ?? null,
      serviceTypeId: stId,
      pcoCreatedAt: (a.created_at as string | undefined) ?? null,
      pcoUpdatedAt: (a.updated_at as string | undefined) ?? null,
      archivedAt: (a.archived_at as string | undefined) ?? null,
      deletedAt: (a.deleted_at as string | undefined) ?? null,
    });
    result.teams.upserted++;
  }

  // 3) Team positions — flat list across all teams.
  for await (const { page } of client.paginate<PCOResource>(
    "/services/v2/team_positions?per_page=100&include=team",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const tp of arr) {
      result.teamPositions.fetched++;
      const a = (tp.attributes ?? {}) as Record<string, unknown>;
      const rels = tp.relationships ?? {};
      const teamRel = rels.team?.data;
      const teamId = !Array.isArray(teamRel) && teamRel ? teamRel.id : null;
      upsertTeamPosition(orgId, {
        pcoId: tp.id,
        teamId,
        name: (a.name as string | undefined) ?? null,
      });
      result.teamPositions.upserted++;
    }
  }

  // 4) Standing roster: who's assigned to each team & in what position.
  //    Per-team replace-in-transaction so dropped people actually disappear.
  const replaceMemberships = getDb().transaction(
    (teamId: string, rows: ReturnType<typeof toTeamMembershipRow>[]) => {
      getDb()
        .prepare(
          "DELETE FROM pco_team_memberships WHERE org_id = ? AND team_id = ?",
        )
        .run(orgId, teamId);
      const stmt = getDb().prepare(
        `INSERT INTO pco_team_memberships
          (org_id, pco_id, team_id, person_id, position_id, position_name,
           is_team_leader, archived_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(org_id, pco_id) DO UPDATE SET
           team_id = excluded.team_id,
           person_id = excluded.person_id,
           position_id = excluded.position_id,
           position_name = excluded.position_name,
           is_team_leader = excluded.is_team_leader,
           archived_at = excluded.archived_at,
           synced_at = excluded.synced_at`,
      );
      for (const r of rows) {
        stmt.run(
          orgId,
          r.pcoId,
          r.teamId,
          r.personId,
          r.positionId,
          r.positionName,
          r.isTeamLeader,
          r.archivedAt,
        );
      }
    },
  );

  for (const team of teamRecords) {
    const memberships: ReturnType<typeof toTeamMembershipRow>[] = [];
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/services/v2/teams/${team.id}/person_team_position_assignments?per_page=100&include=team_position`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        const positionByPersonAssignmentRels = new Map<string, string>(); // unused; team_position rel below
        void positionByPersonAssignmentRels;
        for (const m of arr) {
          result.teamMemberships.fetched++;
          memberships.push(toTeamMembershipRow(team.id, m));
        }
      }
    } catch {
      // Some teams 404 on the assignments endpoint; skip.
    }
    if (memberships.length > 0) {
      replaceMemberships(team.id, memberships);
      result.teamMemberships.upserted += memberships.length;
    } else {
      // Still wipe the team's roster so it isn't stale.
      getDb()
        .prepare(
          "DELETE FROM pco_team_memberships WHERE org_id = ? AND team_id = ?",
        )
        .run(orgId, team.id);
    }
  }

  // 5) Plans — incremental on sort_date. Cursor-aware so subsequent syncs
  //    pull only newer plans, with the threshold backstop.
  const planCursor = readCursor(orgId, "services:plans", thresholdMonths);
  const planParams = new URLSearchParams({
    per_page: "100",
    order: "-sort_date",
    include: "service_type",
  });
  if (planCursor) planParams.set("where[sort_date][gt]", planCursor);
  let maxSortDate: string | null = planCursor;
  const recentPlanIds: string[] = [];
  for await (const { page } of client.paginate<PCOResource>(
    `/services/v2/plans?${planParams.toString()}`,
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const p of arr) {
      result.plans.fetched++;
      const a = (p.attributes ?? {}) as Record<string, unknown>;
      const rels = p.relationships ?? {};
      const stRel = rels.service_type?.data;
      const stId = !Array.isArray(stRel) && stRel ? stRel.id : null;
      const sortDate = (a.sort_date as string | undefined) ?? null;
      if (sortDate && (!maxSortDate || sortDate > maxSortDate)) {
        maxSortDate = sortDate;
      }
      upsertPlan(orgId, {
        pcoId: p.id,
        serviceTypeId: stId,
        title: (a.title as string | undefined) ?? null,
        sortDate,
        pcoCreatedAt: (a.created_at as string | undefined) ?? null,
        pcoUpdatedAt: (a.updated_at as string | undefined) ?? null,
      });
      result.plans.upserted++;
      recentPlanIds.push(p.id);
    }
  }
  writeCursor(orgId, "services:plans", maxSortDate);

  // 6) Plan people — per plan. Replace in transaction per plan.
  const replacePlanPeople = getDb().transaction(
    (planId: string, rows: ReturnType<typeof toPlanPersonRow>[]) => {
      getDb()
        .prepare("DELETE FROM pco_plan_people WHERE org_id = ? AND plan_id = ?")
        .run(orgId, planId);
      const stmt = getDb().prepare(
        `INSERT INTO pco_plan_people
          (org_id, pco_id, plan_id, person_id, team_id, team_position_name, status, pco_created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(org_id, pco_id) DO UPDATE SET
           plan_id = excluded.plan_id,
           person_id = excluded.person_id,
           team_id = excluded.team_id,
           team_position_name = excluded.team_position_name,
           status = excluded.status,
           pco_created_at = excluded.pco_created_at,
           synced_at = excluded.synced_at`,
      );
      for (const r of rows) {
        stmt.run(
          orgId,
          r.pcoId,
          r.planId,
          r.personId,
          r.teamId,
          r.teamPositionName,
          r.status,
          r.pcoCreatedAt,
        );
      }
    },
  );

  for (const planId of recentPlanIds) {
    const ppRows: ReturnType<typeof toPlanPersonRow>[] = [];
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/services/v2/plans/${planId}/team_members?per_page=100&include=team`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        for (const pp of arr) {
          result.planPeople.fetched++;
          ppRows.push(toPlanPersonRow(planId, pp));
        }
      }
    } catch {
      // Skip on 404
    }
    if (ppRows.length > 0) {
      replacePlanPeople(planId, ppRows);
      result.planPeople.upserted += ppRows.length;
    }
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toTeamMembershipRow(teamId: string, m: PCOResource) {
  const a = (m.attributes ?? {}) as Record<string, unknown>;
  const rels = m.relationships ?? {};
  const personRel = rels.person?.data;
  const positionRel = rels.team_position?.data;
  return {
    pcoId: m.id,
    teamId,
    personId: !Array.isArray(personRel) && personRel ? personRel.id : "",
    positionId: !Array.isArray(positionRel) && positionRel ? positionRel.id : null,
    positionName: (a.position_name as string | undefined) ?? null,
    isTeamLeader: (a.is_team_leader === true ? 1 : 0) as 0 | 1,
    archivedAt: (a.archived_at as string | undefined) ?? null,
  };
}

function toPlanPersonRow(planId: string, pp: PCOResource) {
  const a = (pp.attributes ?? {}) as Record<string, unknown>;
  const rels = pp.relationships ?? {};
  const personRel = rels.person?.data;
  const teamRel = rels.team?.data;
  return {
    pcoId: pp.id,
    planId,
    personId: !Array.isArray(personRel) && personRel ? personRel.id : "",
    teamId: !Array.isArray(teamRel) && teamRel ? teamRel.id : null,
    teamPositionName: (a.team_position_name as string | undefined) ?? null,
    status: (a.status as string | undefined) ?? null,
    pcoCreatedAt: (a.created_at as string | undefined) ?? null,
  };
}

function upsertServiceType(
  orgId: number,
  s: {
    pcoId: string;
    name: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
    archivedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_service_types
        (org_id, pco_id, name, pco_created_at, pco_updated_at, archived_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         pco_created_at = excluded.pco_created_at,
         pco_updated_at = excluded.pco_updated_at,
         archived_at = excluded.archived_at,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, s.pcoId, s.name, s.pcoCreatedAt, s.pcoUpdatedAt, s.archivedAt);
}

function upsertTeam(
  orgId: number,
  t: {
    pcoId: string;
    name: string | null;
    serviceTypeId: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
    archivedAt: string | null;
    deletedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_teams
        (org_id, pco_id, name, service_type_id, pco_created_at, pco_updated_at, archived_at, deleted_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         service_type_id = excluded.service_type_id,
         pco_created_at = excluded.pco_created_at,
         pco_updated_at = excluded.pco_updated_at,
         archived_at = excluded.archived_at,
         deleted_at = excluded.deleted_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      t.pcoId,
      t.name,
      t.serviceTypeId,
      t.pcoCreatedAt,
      t.pcoUpdatedAt,
      t.archivedAt,
      t.deletedAt,
    );
}

function upsertTeamPosition(
  orgId: number,
  p: { pcoId: string; teamId: string | null; name: string | null },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_team_positions (org_id, pco_id, team_id, name, synced_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         team_id = excluded.team_id,
         name = excluded.name,
         synced_at = excluded.synced_at`,
    )
    .run(orgId, p.pcoId, p.teamId, p.name);
}

function upsertPlan(
  orgId: number,
  p: {
    pcoId: string;
    serviceTypeId: string | null;
    title: string | null;
    sortDate: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_plans
        (org_id, pco_id, service_type_id, title, sort_date, pco_created_at, pco_updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         service_type_id = excluded.service_type_id,
         title = excluded.title,
         sort_date = excluded.sort_date,
         pco_created_at = excluded.pco_created_at,
         pco_updated_at = excluded.pco_updated_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      p.pcoId,
      p.serviceTypeId,
      p.title,
      p.sortDate,
      p.pcoCreatedAt,
      p.pcoUpdatedAt,
    );
}

/** Recompute last_served_at per team membership from pco_plan_people +
 *  pco_plans.sort_date (when they served). */
export function refreshLastServed(orgId: number) {
  getDb()
    .prepare(
      `UPDATE pco_team_memberships
         SET last_served_at = (
           SELECT MAX(p.sort_date)
             FROM pco_plan_people pp
             JOIN pco_plans p
               ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
             WHERE pp.org_id = pco_team_memberships.org_id
               AND pp.team_id = pco_team_memberships.team_id
               AND pp.person_id = pco_team_memberships.person_id
               AND lower(coalesce(pp.status, 'c')) IN ('c', 'confirmed', 'u', 'unconfirmed')
         )
       WHERE org_id = ?`,
    )
    .run(orgId);
}

// ─── Cursor helpers (mirror pco-sync-groups to avoid circular imports) ────

function readStoredCursor(orgId: number, resource: string): string | null {
  const row = getDb()
    .prepare(
      "SELECT last_updated_at FROM pco_sync_cursor WHERE org_id = ? AND resource = ?",
    )
    .get(orgId, resource) as { last_updated_at: string | null } | undefined;
  return row?.last_updated_at ?? null;
}

function readCursor(orgId: number, resource: string, thresholdMonths: number): string | null {
  const stored = readStoredCursor(orgId, resource);
  if (!stored) return null;
  const lookbackMs = thresholdMonths * 30 * 24 * 60 * 60 * 1000;
  const lookbackIso = new Date(Date.now() - lookbackMs).toISOString();
  return stored < lookbackIso ? stored : lookbackIso;
}

function writeCursor(orgId: number, resource: string, updatedAt: string | null) {
  if (!updatedAt) return;
  getDb()
    .prepare(
      `INSERT INTO pco_sync_cursor (org_id, resource, last_updated_at, last_synced_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, resource) DO UPDATE SET
         last_updated_at = excluded.last_updated_at,
         last_synced_at = excluded.last_synced_at`,
    )
    .run(orgId, resource, updatedAt);
}
