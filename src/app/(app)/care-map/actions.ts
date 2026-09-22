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
  // care_assignments has foreign keys to pco_people (0094), and OR IGNORE
  // does not cover them. Both pickers list only pco_people, but an id can
  // leave between page load and submit (the sync's junk-name filter), so a
  // missing shepherd is a clear error and a missing person is skipped.
  const inPco = db.prepare(`SELECT 1 FROM pco_people WHERE org_id = ? AND pco_id = ?`);
  if (!inPco.get(session.orgId, shepherdPersonId)) {
    throw new Error("That shepherd is no longer in PCO. Reload the page.");
  }

  // Tidy first: drop any rows for people who are now shepherded so
  // coverage counts stay honest.
  pruneShepherdedCareAssignments(session.orgId);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO care_assignments
       (org_id, shepherd_person_id, person_id, note)
     SELECT org_id, ?, pco_id, ? FROM pco_people WHERE org_id = ? AND pco_id = ?`,
  );
  const insertMany = db.transaction((ids: string[]) => {
    for (const pid of ids) {
      insert.run(shepherdPersonId, note, session.orgId, pid);
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
