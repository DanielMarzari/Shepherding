import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { getExcludedGroupTypes, getExcludedMembershipTypes } from "./pco";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export interface CommunityPersonRow {
  pcoId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  groupCount: number;
  joinedFirstAt: string | null;
}

export interface CommunityLaneStats {
  /** People with at least one active group membership in a non-excluded group. */
  members: number;
  /** Distinct active groups (non-excluded). */
  groups: number;
  /** Members who joined within the activity-tracking window. */
  joinedRecently: number;
  /** People whose only memberships are in excluded types. */
  excludedOnly: number;
}

function nonExcludedJoin(
  excludedGroupTypes: string[],
): { join: string; args: string[] } {
  const join = `
    JOIN pco_groups g
      ON g.org_id = m.org_id
     AND g.pco_id = m.group_id
  `;
  if (excludedGroupTypes.length === 0) {
    return { join, args: [] };
  }
  const placeholders = excludedGroupTypes.map(() => "?").join(",");
  return {
    join: `
      ${join}
       AND (g.group_type_id IS NULL OR g.group_type_id NOT IN (${placeholders}))
    `,
    args: excludedGroupTypes,
  };
}

export function getCommunityLaneStats(
  orgId: number,
  trackingMonths: number,
): CommunityLaneStats {
  const db = getDb();
  const excludedGroupTypes = getExcludedGroupTypes(orgId);
  const excludedMembership = getExcludedMembershipTypes(orgId);
  const trackingCutoff = new Date(
    Date.now() - trackingMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { join, args: joinArgs } = nonExcludedJoin(excludedGroupTypes);

  const memWhere =
    excludedMembership.length === 0
      ? ""
      : ` AND (p.membership_type IS NULL OR p.membership_type NOT IN (${excludedMembership
          .map(() => "?")
          .join(",")}))`;

  const memberRow = db
    .prepare(
      `SELECT
         COUNT(DISTINCT m.person_id) AS members,
         COUNT(DISTINCT m.group_id) AS groups,
         COUNT(DISTINCT CASE WHEN m.joined_at IS NOT NULL AND m.joined_at >= ? THEN m.person_id END) AS joinedRecently
       FROM pco_group_memberships m
       ${join}
       JOIN pco_people p ON p.org_id = m.org_id AND p.pco_id = m.person_id
       WHERE m.org_id = ?
         AND m.archived_at IS NULL
         ${memWhere}`,
    )
    .get(trackingCutoff, ...joinArgs, orgId, ...excludedMembership) as {
    members: number;
    groups: number;
    joinedRecently: number;
  };

  // People whose only memberships fall in excluded types.
  const excludedOnly =
    excludedGroupTypes.length === 0
      ? 0
      : ((db
          .prepare(
            `SELECT COUNT(DISTINCT person_id) AS n FROM pco_group_memberships m
              WHERE m.org_id = ?
                AND m.archived_at IS NULL
                AND m.person_id NOT IN (
                  SELECT m2.person_id
                    FROM pco_group_memberships m2
                    JOIN pco_groups g2 ON g2.org_id = m2.org_id AND g2.pco_id = m2.group_id
                   WHERE m2.org_id = ?
                     AND m2.archived_at IS NULL
                     AND (g2.group_type_id IS NULL OR g2.group_type_id NOT IN (${excludedGroupTypes
                       .map(() => "?")
                       .join(",")}))
                )`,
          )
          .get(orgId, orgId, ...excludedGroupTypes) as { n: number }).n);

  return {
    members: memberRow.members,
    groups: memberRow.groups,
    joinedRecently: memberRow.joinedRecently,
    excludedOnly,
  };
}

// ─── Groups list (used by /groups) ─────────────────────────────────────

export interface SyncedGroupRow {
  pcoId: string;
  name: string | null;
  schedule: string | null;
  groupTypeName: string | null;
  members: number;
  joinedRecently: number;
  archivedRecently: number;
  recentEvents: number;
  pcoCreatedAt: string | null;
  archivedAt: string | null;
  state: "growing" | "shrinking" | "steady" | "paused";
}

export function listGroups(
  orgId: number,
  trackingMonths: number,
): SyncedGroupRow[] {
  const db = getDb();
  const trackingCutoff = new Date(
    Date.now() - trackingMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = db
    .prepare(
      `SELECT
         g.pco_id            AS pcoId,
         g.name              AS name,
         g.schedule          AS schedule,
         t.name              AS groupTypeName,
         g.pco_created_at    AS pcoCreatedAt,
         g.archived_at       AS archivedAt,
         (SELECT COUNT(*)
            FROM pco_group_memberships m
            WHERE m.org_id = g.org_id
              AND m.group_id = g.pco_id
              AND m.archived_at IS NULL) AS members,
         (SELECT COUNT(*)
            FROM pco_group_memberships m
            WHERE m.org_id = g.org_id
              AND m.group_id = g.pco_id
              AND m.archived_at IS NULL
              AND m.joined_at IS NOT NULL
              AND m.joined_at >= ?) AS joinedRecently,
         (SELECT COUNT(*)
            FROM pco_group_memberships m
            WHERE m.org_id = g.org_id
              AND m.group_id = g.pco_id
              AND m.archived_at IS NOT NULL
              AND m.archived_at >= ?) AS archivedRecently,
         (SELECT COUNT(*)
            FROM pco_group_events e
            WHERE e.org_id = g.org_id
              AND e.group_id = g.pco_id
              AND e.starts_at IS NOT NULL
              AND e.starts_at >= ?) AS recentEvents
       FROM pco_groups g
       LEFT JOIN pco_group_types t
         ON t.org_id = g.org_id AND t.pco_id = g.group_type_id
       WHERE g.org_id = ?
       ORDER BY g.archived_at IS NULL DESC, members DESC, g.name ASC`,
    )
    .all(trackingCutoff, trackingCutoff, trackingCutoff, orgId) as Array<{
    pcoId: string;
    name: string | null;
    schedule: string | null;
    groupTypeName: string | null;
    pcoCreatedAt: string | null;
    archivedAt: string | null;
    members: number;
    joinedRecently: number;
    archivedRecently: number;
    recentEvents: number;
  }>;

  return rows.map((r) => {
    let state: SyncedGroupRow["state"];
    if (r.archivedAt) state = "paused";
    else if (r.recentEvents === 0 && r.members > 0) state = "paused";
    else {
      const net = r.joinedRecently - r.archivedRecently;
      if (net >= 2) state = "growing";
      else if (net <= -2) state = "shrinking";
      else state = "steady";
    }
    return { ...r, state };
  });
}

export interface GroupTotals {
  totalGroups: number;
  activeGroups: number;
  growing: number;
  steady: number;
  shrinking: number;
  paused: number;
  totalMembers: number;
}

export function getGroupTotals(
  orgId: number,
  trackingMonths: number,
): GroupTotals {
  const groups = listGroups(orgId, trackingMonths);
  const totals: GroupTotals = {
    totalGroups: groups.length,
    activeGroups: groups.filter((g) => !g.archivedAt).length,
    growing: 0,
    steady: 0,
    shrinking: 0,
    paused: 0,
    totalMembers: 0,
  };
  for (const g of groups) {
    if (g.archivedAt) continue;
    totals.totalMembers += g.members;
    totals[g.state]++;
  }
  return totals;
}

export function listCommunityPeople(
  orgId: number,
  limit = 100,
): CommunityPersonRow[] {
  const db = getDb();
  const excludedGroupTypes = getExcludedGroupTypes(orgId);
  const excludedMembership = getExcludedMembershipTypes(orgId);
  const { join, args: joinArgs } = nonExcludedJoin(excludedGroupTypes);
  const memWhere =
    excludedMembership.length === 0
      ? ""
      : ` AND (p.membership_type IS NULL OR p.membership_type NOT IN (${excludedMembership
          .map(() => "?")
          .join(",")}))`;

  const rows = db
    .prepare(
      `SELECT
         p.pco_id AS pcoId,
         p.enc_pii AS encPii,
         p.membership_type AS membershipType,
         COUNT(DISTINCT m.group_id) AS groupCount,
         MIN(m.joined_at) AS joinedFirstAt
       FROM pco_group_memberships m
       ${join}
       JOIN pco_people p ON p.org_id = m.org_id AND p.pco_id = m.person_id
       WHERE m.org_id = ?
         AND m.archived_at IS NULL
         ${memWhere}
       GROUP BY p.pco_id, p.enc_pii, p.membership_type
       ORDER BY COUNT(DISTINCT m.group_id) DESC, MIN(m.joined_at) DESC NULLS LAST
       LIMIT ?`,
    )
    .all(...joinArgs, orgId, ...excludedMembership, limit) as {
    pcoId: string;
    encPii: string | null;
    membershipType: string | null;
    groupCount: number;
    joinedFirstAt: string | null;
  }[];

  return rows.map((r) => {
    const pii = decryptJson<PIIBlob>(r.encPii) ?? {};
    const firstName = pii.first_name ?? null;
    const lastName = pii.last_name ?? null;
    const fullName =
      [firstName, lastName].filter(Boolean).join(" ") || `(unknown #${r.pcoId})`;
    const initials =
      ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "??";
    return {
      pcoId: r.pcoId,
      fullName,
      initials,
      membershipType: r.membershipType,
      groupCount: r.groupCount,
      joinedFirstAt: r.joinedFirstAt,
    };
  });
}
