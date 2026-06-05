"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { saveMetricsSettings, saveServingInterestFormId } from "@/lib/pco";
import { saveSecondCampusMaxHours } from "@/lib/map-settings";

export interface MetricsSaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveMapRadiusAction(
  _prev: MetricsSaveState | null,
  formData: FormData,
): Promise<MetricsSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change this." };
  }
  const hours = Number(formData.get("hours"));
  if (!Number.isFinite(hours) || hours <= 0) {
    return { status: "error", message: "Enter a positive number of hours." };
  }
  saveSecondCampusMaxHours(s.orgId, hours);
  revalidatePath("/metrics");
  revalidatePath("/map");
  return { status: "saved", message: `Excluding homes over ${hours}h away.` };
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
  const lapsedTeamEvents = Number(formData.get("lapsedFromTeamEvents") ?? 3);
  const checkinMin = Number(
    formData.get("shepherdedCheckinMinEvents") ?? 3,
  );
  const checkinWindow = Number(
    formData.get("shepherdedCheckinWindowMonths") ?? 12,
  );
  saveMetricsSettings(
    s.orgId,
    activity,
    sync,
    tracking,
    lapsed,
    lapsedTeamMonths,
    lapsedTeamEvents,
    checkinMin,
    checkinWindow,
  );
  revalidatePath("/teams");
  revalidatePath("/lanes/serv");
  revalidatePath("/metrics");
  revalidatePath("/people");
  revalidatePath("/attendance");
  return { status: "saved", message: "Thresholds saved." };
}

export interface ServingFormState {
  status: "idle" | "saved" | "error";
  message?: string;
}

/** Persist the org's choice of "serving interest" form. Drives the
 *  /pipeline page's trigger logic. Saving "" clears the selection so
 *  the pipeline falls back to "any form submission". */
export async function saveServingInterestFormAction(
  _prev: ServingFormState | null,
  formData: FormData,
): Promise<ServingFormState> {
  const session = await requireOrg();
  if (session.role !== "admin") {
    return { status: "error", message: "Admin only." };
  }
  const raw = String(formData.get("formId") ?? "").trim();
  const formId = raw === "" ? null : raw;
  saveServingInterestFormId(session.orgId, formId);
  revalidatePath("/metrics");
  revalidatePath("/pipeline");
  return {
    status: "saved",
    message: formId ? "Saved." : "Cleared — pipeline will use any form.",
  };
}
