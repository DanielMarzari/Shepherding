"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { saveSqlTheme } from "@/lib/builder-theme-store";
import { normalizeSqlTheme, type SqlTheme } from "@/lib/builder-theme";

export async function saveSqlThemeAction(theme: SqlTheme): Promise<{ ok: boolean; message: string }> {
  const s = await requireOrg();
  if (s.role !== "admin") return { ok: false, message: "Only admins can change the editor colors." };
  saveSqlTheme(s.orgId, normalizeSqlTheme(theme));
  // Re-inject the theme in the (app) layout for every route.
  revalidatePath("/", "layout");
  return { ok: true, message: "Editor colors saved." };
}
