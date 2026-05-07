"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
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
