"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  saveAdultCheckinEvents,
  saveExcludedCheckinEvents,
  saveExcludedGroupTypes,
  saveExcludedMembershipTypes,
  saveExcludedTeamPositions,
  saveExcludedTeamTypes,
  saveKidCheckinEvents,
} from "@/lib/pco";

export interface FilterSaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveFiltersAction(
  _prev: FilterSaveState | null,
  formData: FormData,
): Promise<FilterSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change filters." };
  }
  const excluded = formData
    .getAll("exclude")
    .filter((v) => typeof v === "string") as string[];
  saveExcludedMembershipTypes(s.orgId, excluded);
  revalidatePath("/pco/filters");
  revalidatePath("/people");
  revalidatePath("/metrics");
  return {
    status: "saved",
    message:
      excluded.length === 0
        ? "All membership types are now included."
        : `Excluding ${excluded.length} membership type${excluded.length === 1 ? "" : "s"}.`,
  };
}

export async function saveTeamTypeFiltersAction(
  _prev: FilterSaveState | null,
  formData: FormData,
): Promise<FilterSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change filters." };
  }
  const excluded = formData
    .getAll("exclude_team_type")
    .filter((v) => typeof v === "string") as string[];
  const excludedPositions = formData
    .getAll("exclude_team_position")
    .filter((v) => typeof v === "string") as string[];
  saveExcludedTeamTypes(s.orgId, excluded);
  saveExcludedTeamPositions(s.orgId, excludedPositions);
  revalidatePath("/pco/filters");
  revalidatePath("/teams");
  revalidatePath("/lanes/serv");
  return {
    status: "saved",
    message:
      excluded.length === 0 && excludedPositions.length === 0
        ? "All service types + positions now count for Serve."
        : `Excluding ${excluded.length} service type${excluded.length === 1 ? "" : "s"} + ${excludedPositions.length} position${excludedPositions.length === 1 ? "" : "s"}.`,
  };
}

export async function saveCheckinEventsAction(
  _prev: FilterSaveState | null,
  formData: FormData,
): Promise<FilterSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change filters." };
  }
  // Each event row submits checkin_event_kind[event_id] =
  //   "kid" | "adult" | "ignore" | "neutral".
  // "neutral" is the new default — uncategorized, no age implication
  // (counts toward shepherded but never flips is_minor). Only events
  // explicitly tagged "kid" go in the kid list and can imply minor.
  const kidIds: string[] = [];
  const adultIds: string[] = [];
  const ignoreIds: string[] = [];
  for (const [key, value] of formData.entries()) {
    const m = key.match(/^checkin_event_kind\[(.+)\]$/);
    if (!m) continue;
    const eventId = m[1];
    if (value === "kid") kidIds.push(eventId);
    else if (value === "adult") adultIds.push(eventId);
    else if (value === "ignore") ignoreIds.push(eventId);
  }
  // Adult + ignore events are excluded from the shepherded check-in
  // count. Kid + neutral events count toward it (they're not excluded).
  const excludedIds = Array.from(new Set([...ignoreIds, ...adultIds]));
  saveExcludedCheckinEvents(s.orgId, excludedIds);
  saveAdultCheckinEvents(s.orgId, adultIds);
  saveKidCheckinEvents(s.orgId, kidIds);
  revalidatePath("/pco/filters");
  revalidatePath("/people");
  revalidatePath("/metrics");
  revalidatePath("/care-queue");
  revalidatePath("/lanes");
  revalidatePath("/lanes/care");
  revalidatePath("/checkins");
  const summary: string[] = [];
  if (kidIds.length > 0)
    summary.push(`${kidIds.length} kid event${kidIds.length === 1 ? "" : "s"}`);
  if (adultIds.length > 0)
    summary.push(`${adultIds.length} adult event${adultIds.length === 1 ? "" : "s"}`);
  if (ignoreIds.length > 0)
    summary.push(`${ignoreIds.length} ignored event${ignoreIds.length === 1 ? "" : "s"}`);
  return {
    status: "saved",
    message:
      summary.length === 0
        ? "No events tagged — unknown-birthday people default to adult."
        : `Marked ${summary.join(" + ")}.`,
  };
}

export async function saveGroupTypeFiltersAction(
  _prev: FilterSaveState | null,
  formData: FormData,
): Promise<FilterSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change filters." };
  }
  const excluded = formData
    .getAll("exclude_group_type")
    .filter((v) => typeof v === "string") as string[];
  saveExcludedGroupTypes(s.orgId, excluded);
  revalidatePath("/pco/filters");
  revalidatePath("/people");
  revalidatePath("/metrics");
  revalidatePath("/lanes");
  revalidatePath("/lanes/comm");
  return {
    status: "saved",
    message:
      excluded.length === 0
        ? "All group types now count for Shepherded."
        : `Excluding ${excluded.length} group type${excluded.length === 1 ? "" : "s"} from Shepherded.`,
  };
}
