"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { saveWeeklyAttendance } from "@/lib/pco";

export interface AttendanceSaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveAttendanceAction(
  _prev: AttendanceSaveState | null,
  formData: FormData,
): Promise<AttendanceSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change this." };
  }
  const raw = formData.get("weekly");
  if (raw == null || raw === "") {
    saveWeeklyAttendance(s.orgId, null);
    revalidatePath("/attendance");
    return { status: "saved", message: "Cleared." };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return { status: "error", message: "Enter a positive number." };
  }
  saveWeeklyAttendance(s.orgId, Math.floor(n));
  revalidatePath("/attendance");
  return { status: "saved", message: `Saved · ${Math.floor(n).toLocaleString()} weekly.` };
}

/** Add a reference to a spreadsheet / doc that holds historical
 *  attendance data. We just store the link + a label so admins can
 *  keep the bibliography in one place — importing the underlying
 *  numbers into our graphs is a future job. */
export async function addAttendanceSourceAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");
  const label = String(formData.get("label") ?? "").trim().slice(0, 200);
  const url = String(formData.get("url") ?? "").trim().slice(0, 2000);
  const notesRaw = String(formData.get("notes") ?? "").trim().slice(0, 1000);
  if (!label) throw new Error("Label required");
  if (!url) throw new Error("URL required");
  try {
    new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL");
  }
  getDb()
    .prepare(
      `INSERT INTO attendance_sources (org_id, label, url, notes)
       VALUES (?, ?, ?, ?)`,
    )
    .run(session.orgId, label, url, notesRaw === "" ? null : notesRaw);
  revalidatePath("/attendance");
}

export async function removeAttendanceSourceAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Bad id");
  getDb()
    .prepare(`DELETE FROM attendance_sources WHERE id = ? AND org_id = ?`)
    .run(id, session.orgId);
  revalidatePath("/attendance");
}
