"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";

function clean(v: FormDataEntryValue | null, max = 12000): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  return s.slice(0, max);
}

/** Create a new Ministry Impact Report and redirect to its detail
 *  page so the admin lands on what they just wrote. */
export async function createMirAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const title = clean(formData.get("title"), 300);
  if (!title) throw new Error("Title required");

  const result = getDb()
    .prepare(
      `INSERT INTO mir_docs
         (org_id, title, target_audience, team,
          resources, activities, outputs, outcomes, impact,
          author_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session.orgId,
      title,
      clean(formData.get("targetAudience"), 500),
      clean(formData.get("team"), 500),
      clean(formData.get("resources")),
      clean(formData.get("activities")),
      clean(formData.get("outputs")),
      clean(formData.get("outcomes")),
      clean(formData.get("impact")),
      session.user.id,
    );
  const id = Number(result.lastInsertRowid);

  revalidatePath("/mir");
  redirect(`/mir/${id}`);
}

export async function updateMirAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Bad id");
  const title = clean(formData.get("title"), 300);
  if (!title) throw new Error("Title required");

  getDb()
    .prepare(
      `UPDATE mir_docs SET
         title = ?, target_audience = ?, team = ?,
         resources = ?, activities = ?, outputs = ?,
         outcomes = ?, impact = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND org_id = ?`,
    )
    .run(
      title,
      clean(formData.get("targetAudience"), 500),
      clean(formData.get("team"), 500),
      clean(formData.get("resources")),
      clean(formData.get("activities")),
      clean(formData.get("outputs")),
      clean(formData.get("outcomes")),
      clean(formData.get("impact")),
      id,
      session.orgId,
    );

  revalidatePath("/mir");
  revalidatePath(`/mir/${id}`);
}

export async function deleteMirAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Bad id");
  getDb()
    .prepare(`DELETE FROM mir_docs WHERE id = ? AND org_id = ?`)
    .run(id, session.orgId);
  revalidatePath("/mir");
  redirect("/mir");
}
