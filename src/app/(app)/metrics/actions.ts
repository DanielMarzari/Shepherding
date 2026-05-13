"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { saveMetricsSettings } from "@/lib/pco";

export interface MetricsSaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveThresholdsAction(
  _prev: MetricsSaveState | null,
  formData: FormData,
): Promise<MetricsSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change thresholds." };
  }
  const activity = Number(formData.get("activityMonths") ?? 18);
  const sync = Number(formData.get("syncThresholdMonths") ?? 3);
  const tracking = Number(formData.get("activityTrackingMonths") ?? 3);
  const lapsed = Number(formData.get("lapsedWeeks") ?? 10);
  const lapsedTeamMonths = Number(formData.get("lapsedFromTeamMonths") ?? 6);
  saveMetricsSettings(s.orgId, activity, sync, tracking, lapsed, lapsedTeamMonths);
  revalidatePath("/teams");
  revalidatePath("/lanes/serv");
  revalidatePath("/metrics");
  revalidatePath("/people");
  revalidatePath("/attendance");
  return { status: "saved", message: "Thresholds saved." };
}
