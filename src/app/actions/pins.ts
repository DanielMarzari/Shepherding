"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { togglePin } from "@/lib/nav-config-db";

/** Toggle a per-user pin (keyed by href). Returns the new pinned state. */
export async function togglePinAction(key: string, path: string): Promise<boolean> {
  const s = await requireOrg();
  const pinned = togglePin(s.orgId, s.user.id, key);
  if (path && path.startsWith("/")) revalidatePath(path);
  return pinned;
}
