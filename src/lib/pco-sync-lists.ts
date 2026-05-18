import "server-only";
import { getDb } from "./db";
import { PCOClient, PCOError, type PCOResource } from "./pco-client";

/** Convention: only lists whose name starts with this prefix (case-
 *  insensitive) get pulled. Keeps Shepherding away from the dozens of
 *  ad-hoc "Mailing — Easter 2024" type lists every PCO org accumulates. */
const REFERENCE_PREFIX = "REFERENCE";

export interface ListsSyncResult {
  lists: { fetched: number; upserted: number };
  listMemberships: { fetched: number; upserted: number };
}

export async function syncListsAll(
  client: PCOClient,
  orgId: number,
): Promise<ListsSyncResult> {
  const result: ListsSyncResult = {
    lists: { fetched: 0, upserted: 0 },
    listMemberships: { fetched: 0, upserted: 0 },
  };

  // 1) Pull every list in PCO. Filter client-side by name prefix so we
  //    don't depend on PCO supporting `where[name][starts_with]`.
  const referenceLists: Array<{
    pcoId: string;
    name: string;
    description: string | null;
    totalPeople: number | null;
    refreshedAt: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
  }> = [];

  for await (const { page } of client.paginate<PCOResource>(
    "/people/v2/lists?per_page=100",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const l of arr) {
      const a = (l.attributes ?? {}) as Record<string, unknown>;
      const name = (a.name as string | undefined) ?? "";
      if (!name.toUpperCase().startsWith(REFERENCE_PREFIX)) continue;
      result.lists.fetched++;
      referenceLists.push({
        pcoId: l.id,
        name,
        description: (a.description as string | undefined) ?? null,
        totalPeople: (a.total_people as number | undefined) ?? null,
        refreshedAt: (a.refreshed_at as string | undefined) ?? null,
        pcoCreatedAt: (a.created_at as string | undefined) ?? null,
        pcoUpdatedAt: (a.updated_at as string | undefined) ?? null,
      });
      upsertList(orgId, referenceLists[referenceLists.length - 1]);
      result.lists.upserted++;
    }
  }

  // 2) Per-list memberships. Replace-in-transaction so people removed
  //    from a list disappear (lists can be recomputed any time).
  const replaceMemberships = getDb().transaction(
    (listId: string, personIds: string[]) => {
      getDb()
        .prepare("DELETE FROM pco_list_memberships WHERE org_id = ? AND list_id = ?")
        .run(orgId, listId);
      const stmt = getDb().prepare(
        `INSERT INTO pco_list_memberships
          (org_id, list_id, person_id, synced_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(org_id, list_id, person_id) DO UPDATE SET
           synced_at = excluded.synced_at`,
      );
      for (const pid of personIds) stmt.run(orgId, listId, pid);
    },
  );

  for (const list of referenceLists) {
    const ids = new Set<string>();
    try {
      for await (const { page } of client.paginate<PCOResource>(
        `/people/v2/lists/${list.pcoId}/people?per_page=100`,
      )) {
        const arr = Array.isArray(page.data) ? page.data : [page.data];
        for (const person of arr) {
          result.listMemberships.fetched++;
          if (person.id) ids.add(person.id);
        }
      }
    } catch (e) {
      // Lists that haven't been "refreshed" recently in PCO sometimes
      // return 404 on /people. Skip rather than fail the whole sync.
      if (!(e instanceof PCOError && e.status === 404)) {
        // swallow other errors per-list
      }
    }
    if (ids.size > 0) {
      replaceMemberships(list.pcoId, Array.from(ids));
      result.listMemberships.upserted += ids.size;
    } else {
      getDb()
        .prepare(
          "DELETE FROM pco_list_memberships WHERE org_id = ? AND list_id = ?",
        )
        .run(orgId, list.pcoId);
    }
  }

  return result;
}

function upsertList(
  orgId: number,
  l: {
    pcoId: string;
    name: string;
    description: string | null;
    totalPeople: number | null;
    refreshedAt: string | null;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO pco_lists
        (org_id, pco_id, name, description, total_people, refreshed_at,
         pco_created_at, pco_updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id, pco_id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         total_people = excluded.total_people,
         refreshed_at = excluded.refreshed_at,
         pco_created_at = excluded.pco_created_at,
         pco_updated_at = excluded.pco_updated_at,
         synced_at = excluded.synced_at`,
    )
    .run(
      orgId,
      l.pcoId,
      l.name,
      l.description,
      l.totalPeople,
      l.refreshedAt,
      l.pcoCreatedAt,
      l.pcoUpdatedAt,
    );
}
