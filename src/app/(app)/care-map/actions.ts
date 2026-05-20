"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { pruneShepherdedCareAssignments } from "@/lib/care-read";

/** Assign one or more people to a shepherd's care roster. The form
 *  posts a single shepherdPersonId and any number of `personId`
 *  entries (one per selected checkbox). UNIQUE (org_id, person_id)
 *  means a person already on someone's roster is skipped rather than
 *  moved — the candidate list never offers an assigned person anyway. */
export async function addCareAssignmentsAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "").trim();
  if (!shepherdPersonId) throw new Error("Pick a shepherd");

  const personIds = formData
    .getAll("personId")
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (personIds.length === 0) throw new Error("Pick at least one person");

  const noteRaw = String(formData.get("note") ?? "").trim();
  const note = noteRaw === "" ? null : noteRaw.slice(0, 500);

  const db = getDb();
  // Tidy first: drop any rows for people who are now shepherded so
  // coverage counts stay honest.
  pruneShepherdedCareAssignments(session.orgId);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO care_assignments
       (org_id, shepherd_person_id, person_id, note)
     VALUES (?, ?, ?, ?)`,
  );
  const insertMany = db.transaction((ids: string[]) => {
    for (const pid of ids) {
      insert.run(session.orgId, shepherdPersonId, pid, note);
    }
  });
  insertMany(personIds);

  revalidatePath("/care-map");
}

export async function removeCareAssignmentAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Bad id");

  getDb()
    .prepare(`DELETE FROM care_assignments WHERE id = ? AND org_id = ?`)
    .run(id, session.orgId);

  revalidatePath("/care-map");
}
