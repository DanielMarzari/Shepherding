"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  type RefreshRunStatus,
  getRefreshRunStatus,
  startRefreshInBackground,
} from "@/lib/dashboard-refresh";

/** Kick off a background snapshot refresh. Returns immediately with
 *  the run id — the client polls getRefreshStatusAction for progress.
 *  The full pco/sync pattern (fire-and-forget + module-level promise
 *  Set) keeps the refresh alive across server-action ticks. */
export async function startRefreshAction(): Promise<
  | { ok: true; runId: number }
  | { ok: false; message: string }
> {
  const session = await requireOrg();
  if (session.role !== "admin") {
    return { ok: false, message: "Admin only." };
  }
  try {
    const runId = startRefreshInBackground(session.orgId);
    return { ok: true, runId };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Refresh failed to start.",
    };
  }
}

/** Polled by the refresh button while a refresh is in flight. Returns
 *  NULL when the runId doesn't exist (shouldn't happen, but defensive). */
export async function getRefreshStatusAction(
  runId: number,
): Promise<RefreshRunStatus | null> {
  await requireOrg();
  return getRefreshRunStatus(runId);
}

/** Called by the client once a refresh finishes "ok" so the dashboard
 *  re-renders with the new snapshot data. */
export async function revalidateDashboardAction(): Promise<void> {
  await requireOrg();
  revalidatePath("/");
  revalidatePath("/lanes");
  revalidatePath("/people");
}
