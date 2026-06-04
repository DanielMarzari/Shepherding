"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { geocodePending } from "@/lib/geocode";

export interface GeocodeState {
  status: "idle" | "done" | "error";
  message?: string;
  remaining?: number;
}

export async function geocodeBatchAction(): Promise<GeocodeState> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return { status: "error", message: "Only admins can geocode addresses." };
  }
  try {
    const { processed, matched, remaining } = await geocodePending(s.orgId, 150);
    revalidatePath("/map");
    return {
      status: "done",
      message: `Processed ${processed} (${matched} placed). ${remaining} left.`,
      remaining,
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Geocoding failed.",
    };
  }
}
