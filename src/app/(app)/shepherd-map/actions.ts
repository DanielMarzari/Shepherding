"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { addAssignments, removeAssignment } from "@/lib/assignments-write";

/** Server action: insert one assignment per selected target. The modal
 *  posts a single targetKind plus any number of `targetId` entries.
 *  The validation and the insert live in assignments-write, shared with
 *  the per-shepherd page, which edits the same table. */
export async function addAssignmentAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "").trim();
  const noteRaw = String(formData.get("note") ?? "").trim();

  addAssignments(
    session.orgId,
    shepherdPersonId,
    String(formData.get("targetKind") ?? "").trim(),
    formData.getAll("targetId").map((v) => String(v)),
    noteRaw === "" ? null : noteRaw.slice(0, 500),
  );

  // The gap list at the top of the map shrinks as connections are made,
  // and every page that counts what a shepherd oversees changes with it.
  revalidatePath("/shepherd-map");
  revalidatePath("/shepherd-team");
  revalidatePath("/shepherd-team/assign");
  revalidatePath("/shepherd-team/assign-inline");
  revalidatePath("/shepherd-team/bandwidth");
  revalidatePath(`/shepherd-team/${shepherdPersonId}`);
}

/** Grant or revoke whole-org access for a shepherd — the exception to
 *  shepherd-map scoping. These people see the entire org (once scope
 *  enforcement lands); everyone else is limited to what they oversee. */
export async function setOrgWideAccessAction(
  personId: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const session = await requireOrg();
  if (session.role !== "admin") return { ok: false };
  if (!personId) return { ok: false };
  const db = getDb();
  if (enabled) {
    // Only a person still in pco_people (foreign key, 0094); for anyone
    // else the switch reverts.
    if (!db.prepare(`SELECT 1 FROM pco_people WHERE org_id = ? AND pco_id = ?`).get(session.orgId, personId)) {
      return { ok: false };
    }
    db.prepare(
      `INSERT OR IGNORE INTO org_wide_access (org_id, person_id) VALUES (?, ?)`,
    ).run(session.orgId, personId);
  } else {
    db.prepare(
      `DELETE FROM org_wide_access WHERE org_id = ? AND person_id = ?`,
    ).run(session.orgId, personId);
  }
  revalidatePath("/shepherd-map");
  return { ok: true };
}

export async function removeAssignmentAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  removeAssignment(session.orgId, Number(formData.get("id")));

  revalidatePath("/shepherd-map");
  revalidatePath("/shepherd-team");
}
