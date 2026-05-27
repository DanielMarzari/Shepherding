import "server-only";
import { getDb } from "./db";

/** One row on the activity timeline. Kept intentionally simple — each
 *  is a single dated point with a category badge and a free-form
 *  description so the UI can group by lane visually.
 *
 *  Categories pick a color:
 *    - "personal"  → record creation, profile updates
 *    - "community" → groups (apply / join / leave / attend cluster)
 *    - "serving"   → teams (added / served cluster)
 *    - "forms"     → form submissions */
export type TimelineCategory = "personal" | "community" | "serving" | "forms";

export interface TimelineEvent {
  at: string; // ISO date
  category: TimelineCategory;
  title: string;
  /** Short context — group name, team name, count of events. */
  detail?: string;
}

/** Build a full activity timeline for a person — chronological list of
 *  milestones from PCO record creation onward. Returns NEWEST first
 *  so the UI shows the latest activity above the fold without paging.
 *
 *  Every individual attendance and plan-served row gets its own entry
 *  (no first/last collapsing) so the user can see the actual cadence.
 *  Future-dated rows are filtered out — PCO sometimes carries plans
 *  scheduled out a year or more, which would otherwise show as 2030
 *  events on a 2026 timeline. */
export function getPersonTimeline(
  orgId: number,
  personId: string,
): TimelineEvent[] {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const events: TimelineEvent[] = [];

  // ─── Personal: record creation ──────────────────────────────────
  const person = db
    .prepare(
      `SELECT pco_created_at, pco_updated_at
         FROM pco_people WHERE org_id = ? AND pco_id = ?`,
    )
    .get(orgId, personId) as
    | { pco_created_at: string | null; pco_updated_at: string | null }
    | undefined;
  if (person?.pco_created_at) {
    events.push({
      at: person.pco_created_at,
      category: "personal",
      title: "Created in PCO",
      detail: "Record first appeared in Planning Center",
    });
  }

  // ─── Community: group applications ──────────────────────────────
  for (const r of db
    .prepare(
      `SELECT a.applied_at AS appliedAt, g.name AS groupName
         FROM pco_group_applications a
         LEFT JOIN pco_groups g
           ON g.org_id = a.org_id AND g.pco_id = a.group_id
        WHERE a.org_id = ? AND a.person_id = ?
          AND a.applied_at IS NOT NULL`,
    )
    .all(orgId, personId) as Array<{
    appliedAt: string;
    groupName: string | null;
  }>) {
    events.push({
      at: r.appliedAt,
      category: "community",
      title: "Applied to a group",
      detail: r.groupName ?? "(unknown group)",
    });
  }

  // ─── Community: group memberships ───────────────────────────────
  for (const r of db
    .prepare(
      `SELECT m.joined_at AS joinedAt, m.archived_at AS archivedAt,
              g.name AS groupName, m.role AS role
         FROM pco_group_memberships m
         LEFT JOIN pco_groups g
           ON g.org_id = m.org_id AND g.pco_id = m.group_id
        WHERE m.org_id = ? AND m.person_id = ?`,
    )
    .all(orgId, personId) as Array<{
    joinedAt: string | null;
    archivedAt: string | null;
    groupName: string | null;
    role: string | null;
  }>) {
    const isLeader =
      typeof r.role === "string" && /leader/i.test(r.role);
    if (r.joinedAt) {
      events.push({
        at: r.joinedAt,
        category: "community",
        title: isLeader ? "Became group leader" : "Joined a group",
        detail: r.groupName ?? "(unknown group)",
      });
    }
    if (r.archivedAt) {
      events.push({
        at: r.archivedAt,
        category: "community",
        title: "Left a group",
        detail: r.groupName ?? "(unknown group)",
      });
    }
  }

  // ─── Community: every attended group event ──────────────────────
  for (const r of db
    .prepare(
      `SELECT a.event_starts_at AS at, g.name AS groupName
         FROM pco_event_attendances a
         LEFT JOIN pco_groups g
           ON g.org_id = a.org_id AND g.pco_id = a.group_id
        WHERE a.org_id = ? AND a.person_id = ?
          AND a.attended = 1
          AND a.event_starts_at IS NOT NULL
          AND a.group_id IS NOT NULL
          AND a.event_starts_at <= ?`,
    )
    .all(orgId, personId, nowIso) as Array<{
    at: string;
    groupName: string | null;
  }>) {
    events.push({
      at: r.at,
      category: "community",
      title: "Attended a group event",
      detail: r.groupName ?? "(unknown group)",
    });
  }

  // ─── Serving: team memberships (added / archived) ───────────────
  for (const r of db
    .prepare(
      `SELECT m.pco_created_at AS addedAt, m.archived_at AS archivedAt,
              t.name AS teamName, m.is_team_leader AS isLeader
         FROM pco_team_memberships m
         LEFT JOIN pco_teams t
           ON t.org_id = m.org_id AND t.pco_id = m.team_id
        WHERE m.org_id = ? AND m.person_id = ?`,
    )
    .all(orgId, personId) as Array<{
    addedAt: string | null;
    archivedAt: string | null;
    teamName: string | null;
    isLeader: number;
  }>) {
    if (r.addedAt) {
      events.push({
        at: r.addedAt,
        category: "serving",
        title: r.isLeader ? "Became team leader" : "Added to a team",
        detail: r.teamName ?? "(unknown team)",
      });
    }
    if (r.archivedAt) {
      events.push({
        at: r.archivedAt,
        category: "serving",
        title: "Removed from a team",
        detail: r.teamName ?? "(unknown team)",
      });
    }
  }

  // ─── Serving: every non-declined plan they were on (one per plan) ─
  for (const r of db
    .prepare(
      `SELECT p.sort_date AS at, t.name AS teamName
         FROM pco_plan_people pp
         JOIN pco_plans p
           ON p.org_id = pp.org_id AND p.pco_id = pp.plan_id
         LEFT JOIN pco_teams t
           ON t.org_id = pp.org_id AND t.pco_id = pp.team_id
        WHERE pp.org_id = ? AND pp.person_id = ?
          AND p.sort_date IS NOT NULL
          AND pp.team_id IS NOT NULL
          AND lower(coalesce(pp.status,'c')) NOT IN ('d','declined')
          AND p.sort_date <= ?`,
    )
    .all(orgId, personId, nowIso) as Array<{
    at: string;
    teamName: string | null;
  }>) {
    events.push({
      at: r.at,
      category: "serving",
      title: "Served on a plan",
      detail: r.teamName ?? "(unknown team)",
    });
  }

  // ─── Forms: submissions ─────────────────────────────────────────
  for (const r of db
    .prepare(
      `SELECT s.pco_created_at AS at, f.name AS formName
         FROM pco_form_submissions s
         LEFT JOIN pco_forms f
           ON f.org_id = s.org_id AND f.pco_id = s.form_id
        WHERE s.org_id = ? AND s.person_id = ?
          AND s.pco_created_at IS NOT NULL`,
    )
    .all(orgId, personId) as Array<{
    at: string;
    formName: string | null;
  }>) {
    events.push({
      at: r.at,
      category: "forms",
      title: "Submitted a form",
      detail: r.formName ?? "(unknown form)",
    });
  }

  // Final safety: drop any event whose timestamp is after "now". The
  // per-query WHERE clauses above already gate the noisy ones (group
  // attendances, plan serves), but a stray future joined_at or form
  // sub from a bad PCO record would still slip through without this.
  const filtered = events.filter((e) => e.at <= nowIso);
  filtered.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return filtered;
}
