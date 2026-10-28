"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { saveSeniorsAgeMin, saveSeniorsSelection } from "@/lib/pco";

export interface SeniorsState {
  status: "idle" | "done" | "error";
  message?: string;
}

/** Save what counts as seniors. One action for the whole picker: the
 *  lists, the four kinds of event and the age are one decision, and
 *  saving them separately would leave the page half-configured between
 *  two round trips. */
export async function saveSeniorsSettingsAction(
  _prev: SeniorsState | null,
  formData: FormData,
): Promise<SeniorsState> {
  const session = await requireOrg();
  if (session.role !== "admin") {
    return { status: "error", message: "Only admins can change this." };
  }
  const ids = (name: string) =>
    formData.getAll(name).map((v) => String(v)).filter(Boolean);

  saveSeniorsSelection(session.orgId, {
    ccLists: ids("ccList"),
    signups: ids("signup"),
    checkinEvents: ids("checkin_event"),
    groupTypes: ids("group_type"),
    groups: ids("group"),
  });

  const age = Number(String(formData.get("ageMin") ?? "").trim());
  if (Number.isFinite(age) && age > 0 && age < 120) {
    saveSeniorsAgeMin(session.orgId, age);
  }

  revalidatePath("/seniors-audit");
  return { status: "done", message: "Saved." };
}
