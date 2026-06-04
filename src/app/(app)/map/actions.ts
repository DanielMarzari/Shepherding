"use server";

import { requireOrg } from "@/lib/auth";
import {
  type GeocodeStatus,
  getGeocodeStatus,
  startGeocodeRun,
} from "@/lib/geocode-runner";

/** Kick off the background geocode run (admin only). Returns immediately;
 *  it continues on its own until the whole directory is geocoded. */
export async function startGeocodeAction(): Promise<
  GeocodeStatus & { forbidden?: boolean }
> {
  const s = await requireOrg();
  if (s.role !== "admin") {
    return {
      forbidden: true,
      running: false,
      processed: 0,
      matched: 0,
      total: 0,
      remaining: 0,
    };
  }
  return startGeocodeRun(s.orgId);
}

/** Poll current progress. */
export async function geocodeStatusAction(): Promise<GeocodeStatus> {
  const s = await requireOrg();
  return getGeocodeStatus(s.orgId);
}
