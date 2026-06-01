"use server";

import { revalidatePath } from "next/cache";
import {
  createIntakeSession,
  destroyIntakeSession,
  getIntakeSession,
  matchShepherdByEmail,
  setKnown,
} from "@/lib/shepherd-intake";

export interface IntakeLoginState {
  status: "idle" | "error";
  message?: string;
}

/** Public email "login" for the shepherd-intake page. Matches the
 *  address to a shepherd-team member; on success sets the signed
 *  intake cookie. Deliberately vague on failure so the form can't be
 *  used to probe who's on the team. */
export async function intakeLoginAction(
  _prev: IntakeLoginState | null,
  formData: FormData,
): Promise<IntakeLoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) {
    return { status: "error", message: "Enter a valid email address." };
  }
  const match = matchShepherdByEmail(email);
  if (!match.ok) {
    if (match.reason === "ambiguous") {
      return {
        status: "error",
        message:
          "That email is shared by more than one shepherd-team member — ask your church admin to set you up directly.",
      };
    }
    return {
      status: "error",
      message:
        "We couldn't find a shepherd-team member with that email. Check the address, or ask your church admin.",
    };
  }
  await createIntakeSession(match.orgId, match.personId);
  revalidatePath("/know");
  return { status: "idle" };
}

export async function intakeLogoutAction(): Promise<void> {
  await destroyIntakeSession();
  revalidatePath("/know");
}

/** Toggle "I know this person". Re-validates the intake session
 *  server-side every call — the personId comes from the signed
 *  cookie, never the client, so a shepherd can only ever write marks
 *  under their own identity. */
export async function toggleKnownAction(
  personId: string,
  known: boolean,
): Promise<{ ok: boolean }> {
  const session = await getIntakeSession();
  if (!session) return { ok: false };
  setKnown(session.orgId, session.personId, personId, known);
  return { ok: true };
}
