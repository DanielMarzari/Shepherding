"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  deleteConstantContactCreds,
  saveConstantContactCreds,
} from "@/lib/constant-contact";
import { runCcSync } from "@/lib/constant-contact-sync";

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
  const appSecretRaw = String(formData.get("appSecret") ?? "").trim();
  const appSecret = appSecretRaw === "" ? null : appSecretRaw;

  if (!apiKey) {
    return { status: "error", message: "API Key is required." };
  }

  saveConstantContactCreds(s.orgId, apiKey, appSecret);
  revalidatePath("/constant-contact");
  return {
    status: "saved",
    message: 'Saved. Now click "Connect Constant Contact" to authorize.',
  };
}

export async function removeConstantContactCredentialsAction() {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  deleteConstantContactCreds(s.orgId);
  revalidatePath("/constant-contact");
}

export async function syncConstantContactAction(
  fullRefresh: boolean,
): Promise<{ ok: boolean; error?: string; requests?: number; capped?: boolean }> {
  const s = await requireOrg();
  if (s.role !== "admin") return { ok: false, error: "Only admins can sync." };
  const r = await runCcSync(s.orgId, "manual", { fullRefresh });
  revalidatePath("/constant-contact/dashboard");
  return { ok: r.ok, error: r.error, requests: r.requests, capped: r.capped };
}
