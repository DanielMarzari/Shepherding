import "server-only";
import { getDb } from "./db";
import { type TargetKind } from "./assignments-types";

/** The writes behind shepherd_assignments — "this shepherd oversees that".
 *
 *  Two pages edit the same table: the shepherd map (every shepherd on one
 *  screen) and a shepherd's own page. The validation lives here so the two
 *  cannot disagree about what a legal connection is.
 */

const VALID_KINDS: ReadonlySet<TargetKind> = new Set([
  "group",
  "group_type",
  "team",
  "service_type",
  "team_position",
  "person",
  "membership_type",
  "shepherd_team",
  "reference_list",
]);

/** Insert one connection per target. Idempotent via the UNIQUE
 *  (org_id, shepherd, kind, target) index — re-adding a pair is a no-op.
 *  Returns how many targets were offered, not how many were new. */
export function addAssignments(
  orgId: number,
  shepherdPersonId: string,
  targetKind: string,
  targetIds: string[],
  note: string | null,
): number {
  if (!shepherdPersonId) throw new Error("Missing shepherd");
  if (!VALID_KINDS.has(targetKind as TargetKind))
    throw new Error("Bad target kind");

  const ids = targetIds.map((v) => String(v).trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("Pick at least one target");

  // Nobody oversees themselves. It is never useful and it would show up
  // as a tile on their own page.
  if (targetKind === "person" && ids.includes(shepherdPersonId)) {
    throw new Error("A shepherd can't oversee themselves");
  }

  const db = getDb();
  // shepherd_assignments.shepherd_person_id has a foreign key to pco_people
  // (0094), which OR IGNORE does not cover. Both pages list only people who
  // were in PCO at render time, and a shepherd can leave in between.
  if (
    !db
      .prepare(`SELECT 1 FROM pco_people WHERE org_id = ? AND pco_id = ?`)
      .get(orgId, shepherdPersonId)
  ) {
    throw new Error("That shepherd is no longer in PCO. Reload the page.");
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO shepherd_assignments
       (org_id, shepherd_person_id, target_kind, target_id, note)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertMany = db.transaction((list: string[]) => {
    for (const tid of list) {
      insert.run(orgId, shepherdPersonId, targetKind, tid, note);
    }
  });
  insertMany(ids);
  return ids.length;
}

export function removeAssignment(orgId: number, id: number): void {
  if (!Number.isFinite(id) || id <= 0) throw new Error("Bad id");
  getDb()
    .prepare(`DELETE FROM shepherd_assignments WHERE id = ? AND org_id = ?`)
    .run(id, orgId);
}
