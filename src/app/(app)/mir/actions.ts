"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { listStaffOptions } from "@/lib/assignments-read";
import type { TargetOption } from "@/lib/assignments-types";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseMirPdf } from "@/lib/mir-pdf-import";
import type Database from "better-sqlite3";

function clean(v: FormDataEntryValue | null, max = 12000): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  return s.slice(0, max);
}

function pickStaffId(
  v: FormDataEntryValue | null,
  staffIds: Set<string>,
  label: string,
): string {
  const s = String(v ?? "").trim();
  if (!s) throw new Error(`${label} is required`);
  if (!staffIds.has(s)) {
    throw new Error(`${label} must be a member of REFERENCE - Church Staff`);
  }
  return s;
}

/** Replace this MIR's additional-team-members rows with the supplied
 *  ids. Lead and sponsor are excluded automatically — they're stored
 *  on mir_docs and surfaced separately. */
function saveTeamMembers(
  db: Database.Database,
  orgId: number,
  mirId: number,
  leadId: string,
  sponsorId: string,
  memberIds: string[],
  staffIds: Set<string>,
) {
  const filtered = [
    ...new Set(
      memberIds.filter(
        (id) => id && id !== leadId && id !== sponsorId && staffIds.has(id),
      ),
    ),
  ];
  db.prepare(`DELETE FROM mir_team_members WHERE org_id = ? AND mir_id = ?`).run(
    orgId,
    mirId,
  );
  if (filtered.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO mir_team_members (org_id, mir_id, person_id) VALUES (?, ?, ?)`,
  );
  const tx = db.transaction((ids: string[]) => {
    for (const pid of ids) insert.run(orgId, mirId, pid);
  });
  tx(filtered);
}

export async function createMirAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const title = clean(formData.get("title"), 300);
  if (!title) throw new Error("Title required");

  const staff = listStaffOptions(session.orgId);
  const staffIds = new Set(staff.map((s) => s.id));
  const leadPersonId = pickStaffId(formData.get("leadPersonId"), staffIds, "Lead");
  const sponsorPersonId = pickStaffId(
    formData.get("sponsorPersonId"),
    staffIds,
    "Sponsor",
  );
  const memberIds = formData.getAll("memberId").map((v) => String(v));

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO mir_docs
         (org_id, title, target_audience,
          lead_person_id, sponsor_person_id,
          resources, activities, outputs, outcomes, impact,
          author_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session.orgId,
      title,
      clean(formData.get("targetAudience"), 500),
      leadPersonId,
      sponsorPersonId,
      clean(formData.get("resources")),
      clean(formData.get("activities")),
      clean(formData.get("outputs")),
      clean(formData.get("outcomes")),
      clean(formData.get("impact")),
      session.user.id,
    );
  const id = Number(result.lastInsertRowid);
  saveTeamMembers(
    db,
    session.orgId,
    id,
    leadPersonId,
    sponsorPersonId,
    memberIds,
    staffIds,
  );

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

  const staff = listStaffOptions(session.orgId);
  const staffIds = new Set(staff.map((s) => s.id));
  const leadPersonId = pickStaffId(formData.get("leadPersonId"), staffIds, "Lead");
  const sponsorPersonId = pickStaffId(
    formData.get("sponsorPersonId"),
    staffIds,
    "Sponsor",
  );
  const memberIds = formData.getAll("memberId").map((v) => String(v));

  const db = getDb();
  db.prepare(
    `UPDATE mir_docs SET
       title = ?, target_audience = ?,
       lead_person_id = ?, sponsor_person_id = ?,
       resources = ?, activities = ?, outputs = ?,
       outcomes = ?, impact = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND org_id = ?`,
  ).run(
    title,
    clean(formData.get("targetAudience"), 500),
    leadPersonId,
    sponsorPersonId,
    clean(formData.get("resources")),
    clean(formData.get("activities")),
    clean(formData.get("outputs")),
    clean(formData.get("outcomes")),
    clean(formData.get("impact")),
    id,
    session.orgId,
  );
  saveTeamMembers(
    db,
    session.orgId,
    id,
    leadPersonId,
    sponsorPersonId,
    memberIds,
    staffIds,
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

/** Map a free-text name (from a PDF) to a staff member's id, best
 *  effort. Tries exact, then "first AND last word", then any substring. */
function matchPerson(
  name: string | null,
  options: TargetOption[],
): string | null {
  if (!name) return null;
  const want = name.toLowerCase().trim();
  if (!want) return null;
  const exact = options.find((o) => o.name.toLowerCase() === want);
  if (exact) return exact.id;
  const parts = want.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    const partial = options.find((o) => {
      const n = o.name.toLowerCase();
      return n.includes(first) && n.includes(last);
    });
    if (partial) return partial.id;
  }
  const sub = options.find((o) => o.name.toLowerCase().includes(want));
  return sub?.id ?? null;
}

export async function uploadMirPdfAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Pick a PDF file to upload");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("PDF is over 10 MB");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseMirPdf(bytes);
  } catch {
    throw new Error("Couldn't read that PDF");
  }

  const staff = listStaffOptions(session.orgId);
  const staffIds = new Set(staff.map((s) => s.id));
  const leadPersonId = matchPerson(parsed.leadName, staff);
  const sponsorPersonId = matchPerson(parsed.sponsorName, staff);
  const memberPersonIds = parsed.memberNames
    .map((n) => matchPerson(n, staff))
    .filter((id): id is string => id !== null);

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id FROM mir_docs
        WHERE org_id = ? AND lower(title) = lower(?) LIMIT 1`,
    )
    .get(session.orgId, parsed.title) as { id: number } | undefined;

  let id: number;
  if (existing) {
    db.prepare(
      `UPDATE mir_docs SET
         title = ?, target_audience = ?,
         lead_person_id = ?, sponsor_person_id = ?,
         resources = ?, activities = ?, outputs = ?,
         outcomes = ?, impact = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND org_id = ?`,
    ).run(
      parsed.title,
      parsed.targetAudience,
      leadPersonId,
      sponsorPersonId,
      parsed.resources,
      parsed.activities,
      parsed.outputs,
      parsed.outcomes,
      parsed.impact,
      existing.id,
      session.orgId,
    );
    id = existing.id;
  } else {
    const r = db
      .prepare(
        `INSERT INTO mir_docs
           (org_id, title, target_audience,
            lead_person_id, sponsor_person_id,
            resources, activities, outputs, outcomes, impact,
            author_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.orgId,
        parsed.title,
        parsed.targetAudience,
        leadPersonId,
        sponsorPersonId,
        parsed.resources,
        parsed.activities,
        parsed.outputs,
        parsed.outcomes,
        parsed.impact,
        session.user.id,
      );
    id = Number(r.lastInsertRowid);
  }

  if (leadPersonId && sponsorPersonId) {
    saveTeamMembers(
      db,
      session.orgId,
      id,
      leadPersonId,
      sponsorPersonId,
      memberPersonIds,
      staffIds,
    );
  }

  revalidatePath("/mir");
  revalidatePath(`/mir/${id}`);
  redirect(`/mir/${id}`);
}
