"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { refreshDashboardSnapshots } from "@/lib/dashboard-refresh";

/** Admin-triggered refresh of the dashboard / lanes snapshot tables.
 *  Useful when you want the headline numbers up-to-the-second without
 *  running a full PCO sync (which also refreshes them at the end). */
export async function refreshDashboardSnapshotsAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  const session = await requireOrg();
  if (session.role !== "admin") {
    return { ok: false, message: "Admin only." };
  }
  try {
    const t0 = Date.now();
    refreshDashboardSnapshots(session.orgId);
    const ms = Date.now() - t0;
    revalidatePath("/");
    revalidatePath("/lanes");
    revalidatePath("/people");
    return { ok: true, message: `Refreshed in ${ms} ms.` };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Refresh failed.",
    };
  }
}
