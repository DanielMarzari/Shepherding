import "server-only";
import { getDb } from "./db";

export interface RetentionCohort {
  /** Calendar year the PCO profile was created (proxy for "joined"). */
  year: number;
  joined: number;
  /** Of those, how many are still active today (classification not
   *  inactive). */
  retained: number;
  pct: number;
}
export interface RetentionSummary {
  cohorts: RetentionCohort[];
  overallJoined: number;
  overallRetained: number;
}

/** Retention by join-cohort: group everyone by the year their PCO
 *  profile was created, then measure how many are still active now
 *  (person_activity.classification != 'inactive'). A read-only roll-up
 *  off the materialized classification — no heavy scan. */
export function getRetentionCohorts(orgId: number): RetentionSummary {
  const rows = getDb()
    .prepare(
      `SELECT CAST(substr(p.pco_created_at, 1, 4) AS INTEGER) AS year,
              COUNT(*) AS joined,
              SUM(CASE WHEN pa.classification IS NOT NULL
                        AND pa.classification != 'inactive'
                       THEN 1 ELSE 0 END) AS retained
         FROM pco_people p
         LEFT JOIN person_activity pa
           ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
        WHERE p.org_id = ?
          AND p.pco_created_at IS NOT NULL
          AND (p.membership_type IS NULL
               OR lower(p.membership_type) NOT LIKE '%system use%')
        GROUP BY year
        ORDER BY year ASC`,
    )
    .all(orgId) as Array<{ year: number; joined: number; retained: number }>;

  const cohorts: RetentionCohort[] = rows
    .filter((r) => r.year && r.year > 1990)
    .map((r) => ({
      year: r.year,
      joined: r.joined,
      retained: r.retained,
      pct: r.joined > 0 ? Math.round((r.retained / r.joined) * 100) : 0,
    }));
  const overallJoined = cohorts.reduce((a, c) => a + c.joined, 0);
  const overallRetained = cohorts.reduce((a, c) => a + c.retained, 0);
  return { cohorts, overallJoined, overallRetained };
}
