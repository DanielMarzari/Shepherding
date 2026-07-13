"use server";

import { revalidatePath } from "next/cache";
import {
  createPresentSession,
  destroyPresentSession,
  getPresentSession,
  matchPresentByEmail,
  setKnownPresent,
} from "@/lib/present-intake";

export interface PresentLoginState {
  status: "idle" | "error";
  message?: string;
}

export async function presentLoginAction(
  _prev: PresentLoginState | null,
  formData: FormData,
): Promise<PresentLoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { status: "error", message: "Enter a valid email address." };
  const match = matchPresentByEmail(email);
  if (!match.ok) {
    if (match.reason === "ambiguous") {
      return { status: "error", message: "That email is shared by more than one person — ask your church admin." };
    }
    // Deliberately vague — don't reveal who's on the allowlist.
    return { status: "error", message: "This page is invite-only. Check the address, or ask your church admin." };
  }
  await createPresentSession(match.orgId, match.personId);
  revalidatePath("/present");
  return { status: "idle" };
}

export async function presentLogoutAction(): Promise<void> {
  await destroyPresentSession();
  revalidatePath("/present");
}

export async function togglePresentKnownAction(personId: string, known: boolean): Promise<{ ok: boolean }> {
  const session = await getPresentSession();
  if (!session) return { ok: false };
  setKnownPresent(session.orgId, session.personId, personId, known);
  return { ok: true };
}
