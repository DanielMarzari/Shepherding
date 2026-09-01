"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { setPerfSuggestionStatus, type PerfStatus } from "@/lib/perf-suggestions";

export async function setPerfStatusAction(formData: FormData) {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  const key = String(formData.get("key") ?? "");
  const status = String(formData.get("status") ?? "") as PerfStatus;
  if (!key || !status) return;
  setPerfSuggestionStatus(s.orgId, key, status);
  revalidatePath("/settings/performance");
}
