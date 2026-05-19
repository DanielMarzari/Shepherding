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
]);

/** Server action: hand off the form payload from the page, validate,
 *  insert. Idempotent via the UNIQUE (org_id, shepherd, kind, target)
 *  index — re-adding the same assignment is a no-op. */
export async function addAssignmentAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "").trim();
  const targetKind = String(formData.get("targetKind") ?? "").trim();
  const targetId = String(formData.get("targetId") ?? "").trim();
  const noteRaw = String(formData.get("note") ?? "").trim();
  const note = noteRaw === "" ? null : noteRaw.slice(0, 500);

  if (!shepherdPersonId) throw new Error("Missing shepherd");
  if (!VALID_KINDS.has(targetKind as TargetKind))
    throw new Error("Bad target kind");
  if (!targetId) throw new Error("Missing target");

  // Disallow a shepherd assigning themselves as their own peer — that's
  // never useful and would clutter the chip list.
  if (targetKind === "person" && targetId === shepherdPersonId) {
    throw new Error("A shepherd can't oversee themselves");
  }

  getDb()
    .prepare(
      `INSERT OR IGNORE INTO shepherd_assignments
         (org_id, shepherd_person_id, target_kind, target_id, note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(session.orgId, shepherdPersonId, targetKind, targetId, note);

  revalidatePath("/shepherd-map");
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
