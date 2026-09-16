"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  INTEGRATIONS,
  deleteIntegrationCredentials,
  saveIntegrationCredentials,
} from "@/lib/integrations";

export interface SaveState {
  status: "idle" | "saved" | "error";
  message?: string;
  provider?: string;
}

export async function saveIntegrationAction(
  _prev: SaveState | null,
  formData: FormData,
): Promise<SaveState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can change credentials." };
  }
  const provider = String(formData.get("provider") ?? "");
  const def = INTEGRATIONS.find((d) => d.provider === provider);
  if (!def) return { status: "error", message: "Unknown integration." };

  const values: Record<string, string> = {};
  let any = false;
  for (const f of def.fields) {
    const v = String(formData.get(f.key) ?? "").trim();
    if (v) any = true;
    values[f.key] = v;
  }
  if (!any) {
    return { status: "error", message: "Nothing to save — every field was blank.", provider };
  }

  saveIntegrationCredentials(s.orgId, provider, values);
  revalidatePath("/settings/integrations");
  return {
    status: "saved",
    message: `${def.name} credentials stored securely. Nothing reads them yet — the sync still has to be built.`,
    provider,
  };
}

export async function removeIntegrationAction(formData: FormData) {
  const s = await requireOrg();
  if (s.role !== "admin") throw new Error("Admin only");
  const provider = String(formData.get("provider") ?? "");
  if (!INTEGRATIONS.some((d) => d.provider === provider)) throw new Error("Unknown integration");
  deleteIntegrationCredentials(s.orgId, provider);
  revalidatePath("/settings/integrations");
}
