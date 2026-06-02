"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { type TargetKind } from "@/lib/assignments-types";

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

/** Server action: insert one assignment per selected target. The modal
 *  posts a single targetKind plus any number of `targetId` entries.
 *  Idempotent via the UNIQUE (org_id, shepherd, kind, target) index —
 *  re-adding the same pair is a no-op. */
export async function addAssignmentAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "").trim();
  const targetKind = String(formData.get("targetKind") ?? "").trim();
  const noteRaw = String(formData.get("note") ?? "").trim();
  const note = noteRaw === "" ? null : noteRaw.slice(0, 500);

  if (!shepherdPersonId) throw new Error("Missing shepherd");
  if (!VALID_KINDS.has(targetKind as TargetKind))
    throw new Error("Bad target kind");

  const targetIds = formData
    .getAll("targetId")
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (targetIds.length === 0) throw new Error("Pick at least one target");

  // Disallow a shepherd assigning themselves as their own peer — that's
  // never useful and would clutter the chip list.
  if (targetKind === "person" && targetIds.includes(shepherdPersonId)) {
    throw new Error("A shepherd can't oversee themselves");
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO shepherd_assignments
       (org_id, shepherd_person_id, target_kind, target_id, note)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertMany = db.transaction((ids: string[]) => {
    for (const tid of ids) {
      insert.run(session.orgId, shepherdPersonId, targetKind, tid, note);
    }
  });
  insertMany(targetIds);

  revalidatePath("/shepherd-map");
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

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Bad id");

  getDb()
    .prepare(
      `DELETE FROM shepherd_assignments WHERE id = ? AND org_id = ?`,
    )
    .run(id, session.orgId);

  revalidatePath("/shepherd-map");
}
