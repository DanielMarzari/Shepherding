"use server";

import { revalidatePath } from "next/cache";
import {
  createUnknownIntakeSession,
  destroyUnknownIntakeSession,
  getUnknownIntakeSession,
  matchUnknownIntakeByEmail,
  setKnownUnknownIntake,
} from "@/lib/unknown-intake";

export interface UnknownIntakeLoginState {
  status: "idle" | "error";
  message?: string;
}

export async function unknownIntakeLoginAction(
  _prev: UnknownIntakeLoginState | null,
  formData: FormData,
): Promise<UnknownIntakeLoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { status: "error", message: "Enter a valid email address." };
  const match = matchUnknownIntakeByEmail(email);
  if (!match.ok) {
    if (match.reason === "ambiguous") {
      return { status: "error", message: "That email is shared by more than one person — ask your church admin." };
    }
    // Deliberately vague — don't reveal who's on the allowlist.
    return { status: "error", message: "This page is invite-only. Check the address, or ask your church admin." };
  }
  await createUnknownIntakeSession(match.orgId, match.personId);
  revalidatePath("/know/unknown");
  return { status: "idle" };
}

export async function unknownIntakeLogoutAction(): Promise<void> {
  await destroyUnknownIntakeSession();
  revalidatePath("/know/unknown");
}

export async function toggleUnknownIntakeKnownAction(personId: string, known: boolean): Promise<{ ok: boolean }> {
  const session = await getUnknownIntakeSession();
  if (!session) return { ok: false };
  setKnownUnknownIntake(session.orgId, session.personId, personId, known);
  return { ok: true };
}
