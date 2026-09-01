"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { saveNavConfig } from "@/lib/nav-config-db";
import type { NavConfig } from "@/lib/nav-registry";

export async function saveNavConfigAction(config: NavConfig): Promise<{ ok: boolean; message: string }> {
  const s = await requireOrg();
  if (s.role !== "admin") return { ok: false, message: "Only admins can change the navigation." };
  const clean = saveNavConfig(s.orgId, config);
  // The sidebar is part of the shared layout on every page — revalidate broadly.
  revalidatePath("/", "layout");
  return { ok: true, message: `Saved — ${clean.groups.length} groups.` };
}
