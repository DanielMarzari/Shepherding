import "server-only";
import { getDb, prepareCached } from "./db";
import { PCOClient, type PCOResource } from "./pco-client";

/** Services person tags.
 *
 *  Three pulls, all small:
 *    1. /services/v2/tag_groups — ~89 groups, one page.
 *    2. /services/v2/tag_groups/{id}/tags — one call per PERSON group.
 *       Song/arrangement groups are skipped; they are the bulk of the 89
 *       and nothing in this app reads them.
 *    3. /services/v2/people?include=tags — 3,481 people, ~35 pages, and
 *       the only efficient way to get assignments. There is no
 *       /services/v2/tags endpoint (404) and no tag→people route, so the
 *       alternative was a call per person: 34k requests against a 100-per-
 *       20s rate limit, i.e. around two hours.
 *
 *  Assignments are replaced wholesale in one transaction rather than
 *  upserted: a tag being REMOVED from someone is the change that matters
 *  for the Outreach lane ("Former Local Outreach Volunteer" exists as its
 *  own tag, so people really do move), and an upsert would never notice.
 */

export interface TagsSyncResult {
  tagGroups: { fetched: number; upserted: number };
  tags: { fetched: number; upserted: number };
  personTags: { fetched: number; upserted: number };
}

const attr = (r: PCOResource) => (r.attributes ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function syncTagsAll(
  client: PCOClient,
  orgId: number,
): Promise<TagsSyncResult> {
  const result: TagsSyncResult = {
    tagGroups: { fetched: 0, upserted: 0 },
    tags: { fetched: 0, upserted: 0 },
    personTags: { fetched: 0, upserted: 0 },
  };

  // 1) Tag groups.
  const personGroupIds: string[] = [];
  for await (const { page } of client.paginate<PCOResource>(
    "/services/v2/tag_groups?per_page=100",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const g of arr) {
      const a = attr(g);
      const tagsFor = str(a.tags_for);
      result.tagGroups.fetched++;
      upsertTagGroup(orgId, { pcoId: g.id, name: str(a.name), tagsFor });
      result.tagGroups.upserted++;
      if ((tagsFor ?? "").toLowerCase() === "person") personGroupIds.push(g.id);
    }
  }

  // 2) Tags inside each person group.
  for (const groupId of personGroupIds) {
    for await (const { page } of client.paginate<PCOResource>(
      `/services/v2/tag_groups/${groupId}/tags?per_page=100`,
    )) {
      const arr = Array.isArray(page.data) ? page.data : [page.data];
      for (const t of arr) {
        result.tags.fetched++;
        upsertTag(orgId, {
          pcoId: t.id,
          tagGroupId: groupId,
          name: str(attr(t).name),
        });
        result.tags.upserted++;
      }
    }
  }

  // 3) Person → tag assignments, collected in memory then swapped in.
  //    ~3.5k people with at most a handful of tags each: a few thousand
  //    pairs, far too small to be worth streaming.
  const pairs: Array<{ personId: string; tagId: string }> = [];
  for await (const { page } of client.paginate<PCOResource>(
    "/services/v2/people?per_page=100&include=tags",
  )) {
    const arr = Array.isArray(page.data) ? page.data : [page.data];
    for (const p of arr) {
      const rels = (p.relationships ?? {}) as Record<
        string,
        { data?: unknown } | undefined
      >;
      const tagRel = rels.tags?.data;
      if (!Array.isArray(tagRel)) continue;
      for (const t of tagRel) {
        const id = (t as { id?: string } | null)?.id;
        if (!id) continue;
        pairs.push({ personId: p.id, tagId: id });
        result.personTags.fetched++;
      }
    }
  }

  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM pco_person_tags WHERE org_id = ?`).run(orgId);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO pco_person_tags (org_id, person_id, tag_id)
       VALUES (?, ?, ?)`,
    );
    for (const { personId, tagId } of pairs) {
      ins.run(orgId, personId, tagId);
      result.personTags.upserted++;
    }
  })();

  return result;
}

function upsertTagGroup(
  orgId: number,
  g: { pcoId: string; name: string | null; tagsFor: string | null },
) {
  prepareCached(
    `INSERT INTO pco_tag_groups (org_id, pco_id, name, tags_for, synced_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       name = excluded.name,
       tags_for = excluded.tags_for,
       synced_at = excluded.synced_at`,
  ).run(orgId, g.pcoId, g.name, g.tagsFor);
}

function upsertTag(
  orgId: number,
  t: { pcoId: string; tagGroupId: string; name: string | null },
) {
  prepareCached(
    `INSERT INTO pco_tags (org_id, pco_id, tag_group_id, name, synced_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       tag_group_id = excluded.tag_group_id,
       name = excluded.name,
       synced_at = excluded.synced_at`,
  ).run(orgId, t.pcoId, t.tagGroupId, t.name);
}
