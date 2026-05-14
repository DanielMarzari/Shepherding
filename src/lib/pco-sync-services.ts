import "server-only";
import { getDb } from "./db";
import { PCOClient, PCOError, type PCOResource } from "./pco-client";

/** PCO Services / Teams sync — service_types, teams, team_positions,
 *  team memberships (the standing roster), plans, and per-plan-per-person
 *  serving records. Drives the Serve lane and the Teams workspace.
 *
 *  Endpoint shape note: PCO Services nests most resources under their
 *  parent (team_positions under teams, plans under service_types, etc.).
 *  An earlier version used flat endpoints and 404'd. */

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

  // 1) Service types — small list ("Sunday Services", "Special Services", etc.)
  const serviceTypeIds: string[] = [];
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
      serviceTypeIds.push(st.id);
    }
  }

  // 2) Teams — under service types. The flat /services/v2/teams works but
  //    we pull per-service-type to also catch teams unique to a type.
  const teamRecords: PCOResource[] = [];
  const seenTeams = new Set<string>();
  for (const stId of serviceTypeIds) {
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/services/v2/service_types/${stId}/teams?per_page=100`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        for (const t of arr) {
          if (seenTeams.has(t.id)) continue;
          seenTeams.add(t.id);
          result.teams.fetched++;
          const a = (t.attributes ?? {}) as Record<string, unknown>;
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
          teamRecords.push(t);
        }
      }
    } catch (e) {
      if (e instanceof PCOError && e.status === 404) continue;
      throw e;
    }
  }

  // 3) Per-team: team_positions, person_team_position_assignments, team_leaders.
  //    Positions live under teams (NOT flat).
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
    // 3a) Positions for this team
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/services/v2/teams/${team.id}/team_positions?per_page=100`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        for (const tp of arr) {
          result.teamPositions.fetched++;
          const a = (tp.attributes ?? {}) as Record<string, unknown>;
          upsertTeamPosition(orgId, {
            pcoId: tp.id,
            teamId: team.id,
            name: (a.name as string | undefined) ?? null,
          });
          result.teamPositions.upserted++;
        }
      }
    } catch (e) {
      if (!(e instanceof PCOError && e.status === 404)) throw e;
    }

    // 3b) Team leaders — separate resource from regular assignments.
    //     Used to mark is_team_leader on the matching membership.
    const leaderPersonIds = new Set<string>();
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/services/v2/teams/${team.id}/team_leaders?per_page=100&include=people`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        const included = page.included ?? [];
        // team_leaders may include people via included; or via relationships.people
        for (const tl of arr) {
          const rels = tl.relationships ?? {};
          const peopleRel = rels.people?.data ?? rels.person?.data;
          if (Array.isArray(peopleRel)) {
            for (const p of peopleRel) leaderPersonIds.add(p.id);
          } else if (peopleRel) {
            leaderPersonIds.add(peopleRel.id);
          }
        }
        for (const inc of included) {
          if (inc.type === "Person") leaderPersonIds.add(inc.id);
        }
      }
    } catch (e) {
      if (!(e instanceof PCOError && e.status === 404)) {
        // Don't blow up sync if team_leaders isn't accessible
      }
    }

    // 3c) Person assignments (the standing roster)
    const memberships: ReturnType<typeof toTeamMembershipRow>[] = [];
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/services/v2/teams/${team.id}/person_team_position_assignments?per_page=100&include=team_position`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        for (const m of arr) {
          result.teamMemberships.fetched++;
          const row = toTeamMembershipRow(team.id, m);
          if (row.personId && leaderPersonIds.has(row.personId)) {
            row.isTeamLeader = 1;
          }
          memberships.push(row);
        }
      }
    } catch (e) {
      if (!(e instanceof PCOError && e.status === 404)) {
        // Skip team on transient error
      }
    }

    if (memberships.length > 0) {
      replaceMemberships(team.id, memberships);
      result.teamMemberships.upserted += memberships.length;
    } else {
      getDb()
        .prepare(
          "DELETE FROM pco_team_memberships WHERE org_id = ? AND team_id = ?",
        )
        .run(orgId, team.id);
    }
  }

  // 4) Plans — re-fetch the recent window every sync so plan_people
  //    status edits (confirm / decline / remove) get refreshed. Initial
  //    sync pulls everything once. Older-than-window plans become
  //    effectively immutable, same model as group events.
  const plansAlreadySynced = !!getDb()
    .prepare("SELECT 1 FROM pco_plans WHERE org_id = ? LIMIT 1")
    .get(orgId);
  const lookbackMs = thresholdMonths * 30 * 24 * 60 * 60 * 1000;
  const planSince = new Date(Date.now() - lookbackMs).toISOString();
  const recentPlans: Array<{ planId: string; serviceTypeId: string }> = [];

  for (const stId of serviceTypeIds) {
    const params = new URLSearchParams({ per_page: "100", order: "-sort_date" });
    if (plansAlreadySynced) params.set("where[sort_date][gte]", planSince);
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/services/v2/service_types/${stId}/plans?${params.toString()}`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        for (const p of arr) {
          result.plans.fetched++;
          const a = (p.attributes ?? {}) as Record<string, unknown>;
          const sortDate = (a.sort_date as string | undefined) ?? null;
          upsertPlan(orgId, {
            pcoId: p.id,
            serviceTypeId: stId,
            title: (a.title as string | undefined) ?? null,
            sortDate,
            pcoCreatedAt: (a.created_at as string | undefined) ?? null,
            pcoUpdatedAt: (a.updated_at as string | undefined) ?? null,
          });
          result.plans.upserted++;
          recentPlans.push({ planId: p.id, serviceTypeId: stId });
        }
      }
    } catch (e) {
      if (!(e instanceof PCOError && e.status === 404)) throw e;
    }
  }
  // No cursor write — we always re-fetch by the rolling window above.

  // 5) Plan team_members — nested under (service_type, plan).
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

  for (const { planId, serviceTypeId } of recentPlans) {
    const ppRows: ReturnType<typeof toPlanPersonRow>[] = [];
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/team_members?per_page=100&include=team`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        for (const pp of arr) {
          result.planPeople.fetched++;
          ppRows.push(toPlanPersonRow(planId, pp));
        }
      }
    } catch (e) {
      if (!(e instanceof PCOError && e.status === 404)) {
        // Skip on transient error
      }
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
    isTeamLeader: 0 as 0 | 1,
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
 *  pco_plans.sort_date (when they served). PCO uses single-letter status
 *  codes ('C'=confirmed, 'U'=unconfirmed, 'D'=declined, 'P'=pending) and
 *  occasionally returns the long form. We count anything not declined. */
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
               AND lower(coalesce(pp.status, 'c')) NOT IN ('d', 'declined')
         )
       WHERE org_id = ?`,
    )
    .run(orgId);
}

