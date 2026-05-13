"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  saveExcludedGroupTypes,
  saveExcludedMembershipTypes,
  saveExcludedTeamTypes,
  saveShepherdedCheckinEvents,
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
  saveExcludedTeamTypes(s.orgId, excluded);
  revalidatePath("/pco/filters");
  revalidatePath("/teams");
  revalidatePath("/lanes/serv");
  return {
    status: "saved",
    message:
      excluded.length === 0
        ? "All service types now count for Serve."
        : `Excluding ${excluded.length} service type${excluded.length === 1 ? "" : "s"} from Serve.`,
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
  const ids = formData
    .getAll("shepherded_checkin_event")
    .filter((v) => typeof v === "string") as string[];
  saveShepherdedCheckinEvents(s.orgId, ids);
  revalidatePath("/pco/filters");
  revalidatePath("/people");
  revalidatePath("/metrics");
  revalidatePath("/care-queue");
  revalidatePath("/lanes");
  revalidatePath("/lanes/care");
  return {
    status: "saved",
    message:
      ids.length === 0
        ? "No events flagged — check-ins won't push anyone to Shepherded."
        : `${ids.length} event${ids.length === 1 ? "" : "s"} flagged as shepherded.`,
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
