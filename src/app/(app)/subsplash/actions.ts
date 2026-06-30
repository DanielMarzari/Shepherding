"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { deleteSubsplashCreds, saveSubsplashCreds } from "@/lib/subsplash";

export interface SaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveSubsplashCredentialsAction(
  _prev: SaveState | null,
  formData: FormData,
): Promise<SaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change Subsplash credentials." };
  }
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const secretRaw = String(formData.get("clientSecret") ?? "").trim();
  const appIdRaw = String(formData.get("appId") ?? "").trim();
  const clientSecret = secretRaw === "" ? null : secretRaw;
  const appId = appIdRaw === "" ? null : appIdRaw;

  if (!apiKey) {
    return { status: "error", message: "API key / access token is required." };
  }

  // No Subsplash API call yet — we just store the credentials securely.
  saveSubsplashCreds(s.orgId, apiKey, clientSecret, appId);
  revalidatePath("/subsplash");
  return {
    status: "saved",
    message: "Credentials stored securely. Engagement sync will be wired up next.",
  };
}

export async function removeSubsplashCredentialsAction() {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  deleteSubsplashCreds(s.orgId);
  revalidatePath("/subsplash");
}
