"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { saveNavConfig } from "@/lib/nav-config-db";
import { createBuilderPage } from "@/lib/builder";
import type { NavConfig } from "@/lib/nav-registry";

export async function saveNavConfigAction(config: NavConfig): Promise<{ ok: boolean; message: string }> {
  const s = await requireOrg();
  if (s.role !== "admin") return { ok: false, message: "Only admins can change the navigation." };
  const clean = saveNavConfig(s.orgId, config);
  // The hub/nav is part of the shared layout on every page — revalidate broadly.
  revalidatePath("/", "layout");
  return { ok: true, message: `Saved — ${clean.groups.length} layer${clean.groups.length === 1 ? "" : "s"}.` };
}

/** Create a blank Page Builder page so the nav builder can add a brand-new page
 *  to a layer. Returns its slug + title (the client adds it as a builder item;
 *  the user edits its content later in the Page Builder). */
export async function createNavPageAction(title: string): Promise<{ slug: string; title: string } | { error: string }> {
  const s = await requireOrg();
  if (s.role !== "admin") return { error: "Only admins can add pages." };
  const t = title.trim();
  if (!t) return { error: "Give the page a name." };
  const slug = createBuilderPage(s.orgId, t);
  return { slug, title: t };
}
