"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  type AssignSource,
  assignPerson,
  autoAssignPool,
  bulkAssignUncontested,
  saveBandwidth,
  unassignPerson,
} from "@/lib/shepherd-assign";

export interface AssignState {
  status: "idle" | "done" | "error";
  message?: string;
}

const PATHS = ["/shepherd-team/assign", "/shepherd-team/assign/contested", "/shepherd-team/assign/pool", "/shepherd-team"];
const revalidateAll = () => PATHS.forEach((p) => revalidatePath(p));

async function admin() {
  const s = await requireOrg();
  if (s.role !== "admin") return null;
  return s;
}

export async function assignOneAction(
  _prev: AssignState | null,
  formData: FormData,
): Promise<AssignState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can assign people." };
  const personId = String(formData.get("personId") ?? "");
  const shepherdId = String(formData.get("shepherdId") ?? "");
  const source = String(formData.get("source") ?? "manual") as AssignSource;
  if (!personId || !shepherdId) {
    return { status: "error", message: "Missing person or shepherd." };
  }
  assignPerson(s.orgId, personId, shepherdId, source);
  revalidateAll();
  return { status: "done", message: "Assigned." };
}

export async function unassignAction(
  _prev: AssignState | null,
  formData: FormData,
): Promise<AssignState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can assign people." };
  const personId = String(formData.get("personId") ?? "");
  if (!personId) return { status: "error", message: "Missing person." };
  unassignPerson(s.orgId, personId);
  revalidateAll();
  return { status: "done", message: "Unassigned." };
}

/** Every uncontested person at once. Safe to press twice: anyone already
 *  assigned is excluded by the query, so a second run moves nobody. */
export async function bulkAssignAction(
  _prev: AssignState | null,
): Promise<AssignState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can assign people." };
  const n = bulkAssignUncontested(s.orgId);
  revalidateAll();
  return {
    status: "done",
    message:
      n === 0
        ? "Nothing to do — every uncontested person already has a shepherd."
        : `${n.toLocaleString()} assigned to the one shepherd who named them.`,
  };
}

export async function autoAssignAction(
  _prev: AssignState | null,
): Promise<AssignState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can assign people." };
  const { assigned, remaining } = autoAssignPool(s.orgId);
  revalidateAll();
  if (assigned === 0 && remaining > 0) {
    return {
      status: "error",
      message:
        "Nobody has room. Set a bandwidth on at least one shepherd first — people are only placed against a bandwidth somebody has agreed to.",
    };
  }
  return {
    status: "done",
    message:
      remaining === 0
        ? `${assigned.toLocaleString()} assigned. The pool is empty.`
        : `${assigned.toLocaleString()} assigned. ${remaining.toLocaleString()} left — the team ran out of bandwidth, not the other way round.`,
  };
}

export async function saveBandwidthAction(
  _prev: AssignState | null,
  formData: FormData,
): Promise<AssignState> {
  const s = await admin();
  if (!s) return { status: "error", message: "Only admins can set bandwidth." };
  let saved = 0;
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("bw_")) continue;
    const shepherdId = key.slice(3);
    const raw = String(value).trim();
    if (raw === "") {
      saveBandwidth(s.orgId, shepherdId, null);
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    saveBandwidth(s.orgId, shepherdId, n);
    saved++;
  }
  revalidateAll();
  return { status: "done", message: `Saved ${saved} bandwidth${saved === 1 ? "" : "s"}.` };
}
