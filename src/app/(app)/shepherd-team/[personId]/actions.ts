"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { addAssignments, removeAssignment } from "@/lib/assignments-write";
import { searchPeople } from "@/lib/people-read";
import {
  assignPerson,
  saveBandwidth,
  unassignPerson,
} from "@/lib/shepherd-assign";

export interface OversightState {
  status: "idle" | "done" | "error";
  message?: string;
}

/** Everything here changes who oversees whom, which every one of these
 *  pages reports on — so they all get revalidated, including the map,
 *  which edits the same table from the other direction. */
function revalidateAll(shepherdPersonId: string) {
  for (const p of [
    `/shepherd-team/${shepherdPersonId}`,
    "/shepherd-team",
    "/shepherd-team/assign",
    "/shepherd-team/bandwidth",
    "/shepherd-map",
  ]) {
    revalidatePath(p);
  }
}

async function admin() {
  const s = await requireOrg();
  return s.role === "admin" ? s : null;
}

/** Add one connection per ticked target — a group, a whole group type, a
 *  team, a service type, a list, a position, a peer. */
export async function addConnectionAction(
  _prev: OversightState | null,
  formData: FormData,
): Promise<OversightState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can change this." };

  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "").trim();
  const targetKind = String(formData.get("targetKind") ?? "").trim();
  const noteRaw = String(formData.get("note") ?? "").trim();
  const targetIds = formData.getAll("targetId").map((v) => String(v));

  try {
    const n = addAssignments(
      s.orgId,
      shepherdPersonId,
      targetKind,
      targetIds,
      noteRaw === "" ? null : noteRaw.slice(0, 500),
    );
    revalidateAll(shepherdPersonId);
    return {
      status: "done",
      message: `Added ${n} connection${n === 1 ? "" : "s"}.`,
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not add that.",
    };
  }
}

export async function removeConnectionAction(
  _prev: OversightState | null,
  formData: FormData,
): Promise<OversightState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can change this." };
  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "");
  try {
    removeAssignment(s.orgId, Number(formData.get("id")));
    revalidateAll(shepherdPersonId);
    return { status: "done", message: "Removed." };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Could not remove that.",
    };
  }
}

/** Hand named individuals to this shepherd. Same table the assignment page
 *  writes, and one shepherd per person — so picking somebody who is already
 *  assigned elsewhere MOVES them here rather than adding a second claim. */
export async function assignPeopleAction(
  _prev: OversightState | null,
  formData: FormData,
): Promise<OversightState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can change this." };

  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "").trim();
  const personIds = formData
    .getAll("personId")
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (!shepherdPersonId || personIds.length === 0) {
    return { status: "error", message: "Nobody selected." };
  }
  for (const pid of personIds) {
    if (pid === shepherdPersonId) continue;
    assignPerson(s.orgId, pid, shepherdPersonId, "manual");
  }
  revalidateAll(shepherdPersonId);
  return {
    status: "done",
    message: `${personIds.length} assigned.`,
  };
}

export async function unassignPersonAction(
  _prev: OversightState | null,
  formData: FormData,
): Promise<OversightState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can change this." };
  const personId = String(formData.get("personId") ?? "").trim();
  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "");
  if (!personId) return { status: "error", message: "Missing person." };
  unassignPerson(s.orgId, personId);
  revalidateAll(shepherdPersonId);
  return { status: "done", message: "Removed." };
}

export async function saveOneBandwidthAction(
  _prev: OversightState | null,
  formData: FormData,
): Promise<OversightState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can set bandwidth." };
  const shepherdPersonId = String(formData.get("shepherdPersonId") ?? "").trim();
  const raw = String(formData.get("bandwidth") ?? "").trim();
  if (!shepherdPersonId) return { status: "error", message: "Missing shepherd." };

  if (raw === "") {
    saveBandwidth(s.orgId, shepherdPersonId, null);
    revalidateAll(shepherdPersonId);
    return { status: "done", message: "Cleared — back to unset." };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return { status: "error", message: "That isn't a number of people." };
  }
  saveBandwidth(s.orgId, shepherdPersonId, n);
  revalidateAll(shepherdPersonId);
  return { status: "done", message: "Saved." };
}

/** The People tab of the picker searches instead of listing: there are
 *  ~34,000 people and shipping all their names to the browser to filter
 *  one of them is not a trade worth making. */
export async function searchPeopleAction(
  query: string,
): Promise<Array<{ id: string; name: string; classification: string }>> {
  const s = await requireOrg();
  return searchPeople(s.orgId, query, 12, 25).map((h) => ({
    id: h.pcoId,
    name: h.fullName,
    classification: h.classification,
  }));
}
