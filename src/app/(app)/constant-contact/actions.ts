"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  deleteConstantContactCreds,
  saveConstantContactCreds,
} from "@/lib/constant-contact";

export interface SaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function saveConstantContactCredentialsAction(
  _prev: SaveState | null,
  formData: FormData,
): Promise<SaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change Constant Contact credentials." };
  }
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const appSecret = String(formData.get("appSecret") ?? "").trim();
  const refreshRaw = String(formData.get("refreshToken") ?? "").trim();
  const refreshToken = refreshRaw === "" ? null : refreshRaw;

  if (!apiKey || !appSecret) {
    return { status: "error", message: "API Key and App Secret are required." };
  }

  // No Constant Contact API call yet — we just store the credentials securely.
  saveConstantContactCreds(s.orgId, apiKey, appSecret, refreshToken);
  revalidatePath("/constant-contact");
  return {
    status: "saved",
    message: "Credentials stored securely. Email sync will be wired up next.",
  };
}

export async function removeConstantContactCredentialsAction() {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  deleteConstantContactCreds(s.orgId);
  revalidatePath("/constant-contact");
}
