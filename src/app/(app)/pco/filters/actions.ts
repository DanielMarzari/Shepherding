"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { recomputeOutreachLane } from "@/lib/dashboard-refresh";
import {
  saveAdultCheckinEvents,
  saveExcludedCheckinEvents,
  saveExcludedGroupTypes,
  saveExcludedMembershipTypes,
  saveExcludedTeamPositions,
  saveExcludedTeamTypes,
  saveKidCheckinEvents,
  saveOutreachGroupTypes,
  saveKnownDefinition,
  saveOutreachServiceTypes,
  saveOutreachTags,
  saveSundayCheckinEvents,
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
  // Sunday morning is orthogonal to the kind above — its own checkbox per row.
  const sundayIds: string[] = [];
  for (const [key, value] of formData.entries()) {
    const sun = key.match(/^checkin_event_sunday\[(.+)\]$/);
    if (sun) {
      sundayIds.push(sun[1]);
      continue;
    }
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
  saveSundayCheckinEvents(s.orgId, sundayIds);
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
  if (sundayIds.length > 0)
    summary.push(`${sundayIds.length} Sunday morning event${sundayIds.length === 1 ? "" : "s"}`);
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

/** The Outreach lane's definition. Include lists, not exclude lists — the
 *  only tab on this page that works that way, because outreach has no
 *  derivable signal to subtract from. Saving changes nothing until the next
 *  snapshot refresh, so the message says so rather than implying the lane
 *  repopulates on submit. */
export async function saveOutreachLaneAction(
  _prev: FilterSaveState | null,
  formData: FormData,
): Promise<FilterSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change filters." };
  }
  const serviceTypes = formData
    .getAll("outreach_service_type")
    .filter((v) => typeof v === "string") as string[];
  const groupTypes = formData
    .getAll("outreach_group_type")
    .filter((v) => typeof v === "string") as string[];
  const tags = formData
    .getAll("outreach_tag")
    .filter((v) => typeof v === "string") as string[];
  saveOutreachServiceTypes(s.orgId, serviceTypes);
  saveOutreachGroupTypes(s.orgId, groupTypes);
  saveOutreachTags(s.orgId, tags);
  // Land it now. This is a settings edit — no PCO data changed — so making
  // the admin wait for the nightly refresh (or sit through a sync) to see
  // their own tick take effect would be absurd.
  let inLane: number | null = null;
  try {
    inLane = recomputeOutreachLane(s.orgId);
  } catch {
    inLane = null;
  }
  revalidatePath("/pco/filters");
  revalidatePath("/audit");
  revalidatePath("/lanes");
  const total = serviceTypes.length + groupTypes.length + tags.length;
  return {
    status: "saved",
    message:
      total === 0
        ? "Nothing counts as outreach — the lane is now empty for everyone."
        : `${total} saved.${
            inLane === null
              ? " The Outreach lane fills on the next snapshot refresh."
              : ` ${inLane.toLocaleString()} people are in the Outreach lane.`
          }`,
  };
}

/** The Known definition. Changing it changes everybody's band, so the
 *  message says plainly that it lands on the next refresh rather than
 *  implying the roster has already moved. */
export async function saveKnownDefinitionAction(
  _prev: FilterSaveState | null,
  formData: FormData,
): Promise<FilterSaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change filters." };
  }
  const signals = formData
    .getAll("signal")
    .filter((v) => typeof v === "string") as string[];
  const min = Number(formData.get("minSignals") ?? 1);
  saveKnownDefinition(s.orgId, signals, Number.isFinite(min) ? min : 1);
  revalidatePath("/pco/filters");
  revalidatePath("/audit");
  revalidatePath("/people");
  return {
    status: "saved",
    message: `Saved. ${signals.length || "All"} signal${signals.length === 1 ? "" : "s"} count toward Known — applied on the next snapshot refresh.`,
  };
}
