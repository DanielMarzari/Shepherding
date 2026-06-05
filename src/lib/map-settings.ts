import "server-only";
import { getDb } from "./db";

export interface MapSettings {
  /** Homes farther than this many hours from Faith Church are excluded
   *  from second-campus siting. */
  secondCampusMaxHours: number;
}

export function getMapSettings(orgId: number): MapSettings {
  const row = getDb()
    .prepare(`SELECT second_campus_max_hours FROM map_settings WHERE org_id = ?`)
    .get(orgId) as { second_campus_max_hours: number } | undefined;
  return { secondCampusMaxHours: row?.second_campus_max_hours ?? 3 };
}

export function saveSecondCampusMaxHours(orgId: number, hours: number) {
  const clamped = Math.max(0.5, Math.min(24, hours));
  getDb()
    .prepare(
      `INSERT INTO map_settings (org_id, second_campus_max_hours, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id) DO UPDATE SET
         second_campus_max_hours = excluded.second_campus_max_hours,
         updated_at = excluded.updated_at`,
    )
    .run(orgId, clamped);
}
