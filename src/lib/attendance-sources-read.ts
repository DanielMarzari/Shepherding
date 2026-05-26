import "server-only";
import { getDb } from "./db";

export interface AttendanceSource {
  id: number;
  label: string;
  url: string;
  notes: string | null;
  createdAt: string;
}

export function listAttendanceSources(orgId: number): AttendanceSource[] {
  return getDb()
    .prepare(
      `SELECT id, label, url, notes, created_at AS createdAt
         FROM attendance_sources
        WHERE org_id = ?
        ORDER BY created_at DESC`,
    )
    .all(orgId) as AttendanceSource[];
}
