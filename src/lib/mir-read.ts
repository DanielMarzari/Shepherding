import "server-only";
import { getDb } from "./db";

export interface MirSummary {
  id: number;
  title: string;
  targetAudience: string | null;
  team: string | null;
  updatedAt: string;
}

export interface MirDoc extends MirSummary {
  resources: string | null;
  activities: string | null;
  outputs: string | null;
  outcomes: string | null;
  impact: string | null;
  authorUserId: number | null;
  createdAt: string;
}

export function listMirs(orgId: number): MirSummary[] {
  return getDb()
    .prepare(
      `SELECT id, title, target_audience AS targetAudience, team,
              updated_at AS updatedAt
         FROM mir_docs
        WHERE org_id = ?
        ORDER BY updated_at DESC`,
    )
    .all(orgId) as MirSummary[];
}

export function getMir(orgId: number, id: number): MirDoc | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, title, target_audience AS targetAudience, team,
                resources, activities, outputs, outcomes, impact,
                author_user_id AS authorUserId,
                created_at AS createdAt, updated_at AS updatedAt
           FROM mir_docs
          WHERE org_id = ? AND id = ?`,
      )
      .get(orgId, id) as MirDoc | undefined) ?? null
  );
}
