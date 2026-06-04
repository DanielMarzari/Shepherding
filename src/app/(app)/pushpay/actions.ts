"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { deletePushpayCreds, savePushpayCreds } from "@/lib/pushpay";

export interface SaveState {
  status: "idle" | "saved" | "error";
  message?: string;
}

export async function savePushpayCredentialsAction(
  _prev: SaveState | null,
  formData: FormData,
): Promise<SaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change PushPay credentials." };
  }
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const orgKeyRaw = String(formData.get("orgKey") ?? "").trim();
  const orgKey = orgKeyRaw === "" ? null : orgKeyRaw;

  if (!clientId || !clientSecret) {
    return { status: "error", message: "Client ID and Client Secret are required." };
  }

  // No PushPay API call yet — we just store the credentials securely.
  savePushpayCreds(s.orgId, clientId, clientSecret, orgKey);
  revalidatePath("/pushpay");
  return {
    status: "saved",
    message: "Credentials stored securely. Sync will be wired up next.",
  };
}

export async function removePushpayCredentialsAction() {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  deletePushpayCreds(s.orgId);
  revalidatePath("/pushpay");
}
