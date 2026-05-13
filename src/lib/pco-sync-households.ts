import "server-only";
import { getDb } from "./db";
import { PCOClient, type PCOResource } from "./pco-client";

/** PCO Households sync — households + per-person membership rows.
 *  Used to derive is_parent on pco_people. */

export interface HouseholdsSyncResult {
  households: { fetched: number; upserted: number };
  householdMemberships: { fetched: number; upserted: number };
}

export async function syncHouseholdsAll(
  client: PCOClient,
  orgId: number,
): Promise<HouseholdsSyncResult> {
  const result: HouseholdsSyncResult = {
    households: { fetched: 0, upserted: 0 },
    householdMemberships: { fetched: 0, upserted: 0 },
  };

  // 1) Households — pull list (small) with primary_contact relationship.
  const householdIds: string[] = [];
  for await (const { page } of client.paginate<PCOResource>(
    "/people/v2/households?per_page=100&include=primary_contact",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const h of arr) {
      result.households.fetched++;
      const a = (h.attributes ?? {}) as Record<string, unknown>;
      const rels = h.relationships ?? {};
      const pc = rels.primary_contact?.data;
      const primaryId = !Array.isArray(pc) && pc ? pc.id : null;
      upsertHousehold(orgId, {
        pcoId: h.id,
        name: (a.name as string | undefined) ?? null,
        memberCount: (a.member_count as number | undefined) ?? null,
        primaryContactId: primaryId,
        pcoCreatedAt: (a.created_at as string | undefined) ?? null,
        pcoUpdatedAt: (a.updated_at as string | undefined) ?? null,
      });
      result.households.upserted++;
      householdIds.push(h.id);
    }
  }

  // 2) Memberships — fetch flat. Replace-in-transaction per household to
  //    catch people who moved out.
  const replaceMemberships = getDb().transaction(
    (
      householdId: string,
      rows: Array<{ pcoId: string; personId: string; pending: number }>,
    ) => {
      getDb()
        .prepare(
          `DELETE FROM pco_household_memberships
            WHERE org_id = ? AND household_id = ?`,
        )
        .run(orgId, householdId);
      const stmt = getDb().prepare(
        `INSERT INTO pco_household_memberships
          (org_id, pco_id, household_id, person_id, pending, synced_at)
         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(org_id, pco_id) DO UPDATE SET
           household_id = excluded.household_id,
           person_id = excluded.person_id,
           pending = excluded.pending,
           synced_at = excluded.synced_at`,
      );
      for (const r of rows) {
        stmt.run(orgId, r.pcoId, householdId, r.personId, r.pending);
      }
    },
  );

  for (const householdId of householdIds) {
    const rows: Array<{ pcoId: string; personId: string; pending: number }> = [];
    for await (const { page } of client.paginate<PCOResource>(
      `/people/v2/households/${householdId}/household_memberships?per_page=100`,
    )) {
      const arr = Array.isArray(page.data) ? page.data : [page.data];
      for (const m of arr) {
        result.householdMemberships.fetched++;
        const a = (m.attributes ?? {}) as Record<string, unknown>;
        const rels = m.relationships ?? {};
        const personRel = rels.person?.data;
        const personId =
          !Array.isArray(personRel) && personRel ? personRel.id : null;
        if (!personId) continue;
        rows.push({
          pcoId: m.id,
          personId,
          pending: a.pending === true ? 1 : 0,
        });
      }
    }
    if (rows.length > 0) {
      replaceMemberships(householdId, rows);
      result.householdMemberships.upserted += rows.length;
    } else {
      getDb()
        .prepare(
          `DELETE FROM pco_household_memberships
            WHERE org_id = ? AND household_id = ?`,
        )
        .run(orgId, householdId);
    }
  }

  return result;
}

/** Set is_parent=1 on adults who share a household with at least one
 *  minor. Run after refreshIsMinor (which sets is_minor based on
 *  birth_year). */
export function refreshIsParent(orgId: number) {
  const db = getDb();
  // First zero out any stale flags.
  db.prepare(
    `UPDATE pco_people SET is_parent = 0 WHERE org_id = ?`,
  ).run(orgId);
  // Then mark adults co-housed with any minor.
  db.prepare(
    `UPDATE pco_people
        SET is_parent = 1
      WHERE org_id = ?
        AND is_minor = 0
        AND pco_id IN (
          SELECT DISTINCT hm_adult.person_id
            FROM pco_household_memberships hm_adult
            WHERE hm_adult.org_id = ?
              AND EXISTS (
                SELECT 1
                  FROM pco_household_memberships hm_kid
                  JOIN pco_people kid
                    ON kid.org_id = hm_kid.org_id
                   AND kid.pco_id = hm_kid.person_id
                  WHERE hm_kid.org_id = hm_adult.org_id
                    AND hm_kid.household_id = hm_adult.household_id
                    AND hm_kid.person_id != hm_adult.person_id
                    AND kid.is_minor = 1
              )
        )`,
  ).run(orgId, orgId);
}

// ─── Helpers ──────────────────────────────────────────────────────────

function upsertHousehold(
  orgId: number,
  h: {
    pcoId: string;
    name: string | null;
    memberCount: number | null;
    primaryContactId: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_households
        (org_id, pco_id, name, member_count, primary_contact_id,
         pco_created_at, pco_updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         member_count = excluded.member_count,
         primary_contact_id = excluded.primary_contact_id,
         pco_created_at = excluded.pco_created_at,
         pco_updated_at = excluded.pco_updated_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      h.pcoId,
      h.name,
      h.memberCount,
      h.primaryContactId,
      h.pcoCreatedAt,
      h.pcoUpdatedAt,
    );
}
