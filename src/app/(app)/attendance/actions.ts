"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  type AttendanceImportResult,
  importAttendanceFile,
} from "@/lib/attendance-import";

/** Remove all imported weekly rows that came from one .xlsx file
 *  (matched by source_file). Lets an admin undo a bad import — the
 *  history chart and the derived adult-attendance average recompute on
 *  the next render. */
export async function removeAttendanceImportAction(formData: FormData) {
  const session = await requireOrg();
  if (session.role !== "admin") throw new Error("Admin only");
  const sourceFile = String(formData.get("sourceFile") ?? "").trim();
  if (!sourceFile) throw new Error("Missing source file");
  getDb()
    .prepare(
      `DELETE FROM attendance_weekly WHERE org_id = ? AND source_file = ?`,
    )
    .run(session.orgId, sourceFile);
  revalidatePath("/attendance");
}

export interface ImportXlsxState {
  status: "idle" | "ok" | "error";
  message?: string;
  results?: AttendanceImportResult[];
}

/** Parse one-or-more "Worship and Activities Attendance" XLSX uploads
 *  and upsert each Sunday's totals into attendance_weekly. The parser
 *  is defensive — files that don't match the expected layout produce a
 *  warning instead of throwing, so a partial batch still imports.
 *
 *  Body-size limit on server actions is bumped to 20 MB in next.config,
 *  so a quarter's worth of files easily fits in one upload. */
export async function importAttendanceXlsxAction(
  _prev: ImportXlsxState | null,
  formData: FormData,
): Promise<ImportXlsxState> {
  const session = await requireOrg();
  if (session.role !== "admin") {
    return { status: "error", message: "Admin only." };
  }
  const files = formData.getAll("files");
  const blobs: File[] = [];
  for (const f of files) {
    if (f instanceof File && f.size > 0) blobs.push(f);
  }
  if (blobs.length === 0) {
    return { status: "error", message: "Pick at least one .xlsx file." };
  }
  const results: AttendanceImportResult[] = [];
  for (const file of blobs) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const r = importAttendanceFile(session.orgId, file.name, buf);
      results.push(r);
    } catch (err) {
      results.push({
        filename: file.name,
        imported: 0,
        weeks: [],
        warnings: [
          `${file.name}: parse failed — ${err instanceof Error ? err.message : String(err)}`,
        ],
      });
    }
  }
  const totalWeeks = results.reduce((s, r) => s + r.imported, 0);
  revalidatePath("/attendance");
  return {
    status: "ok",
    message: `Imported ${totalWeeks.toLocaleString()} weekly rows from ${results.length} file${
      results.length === 1 ? "" : "s"
    }.`,
    results,
  };
}
