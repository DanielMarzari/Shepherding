import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
  birthdate?: string | null;
  address?: string | null;
}

export type AuditFlag =
  | "deceased"
  | "inactive"
  | "junk-name"
  | "weird-name"
  | "no-birthdate"
  | "possible-duplicate"
  | "stale-pco-record"
  | "no-activity-no-rosters";

export interface AuditRow {
  pcoId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  status: string | null;
  isMinor: boolean;
  pcoCreatedAt: string | null;
  pcoUpdatedAt: string | null;
  inactivatedAt: string | null;
  groupsCount: number;
  teamsCount: number;
  recentCheckins: number;
  flags: AuditFlag[];
}

export interface AuditResult {
  membershipType: string;
  rows: AuditRow[];
  flagCounts: Record<AuditFlag, number>;
  totalScanned: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns every person whose membership_type matches `membershipType`,
 *  with one or more flags per row when something looks off. Designed
 *  as a manual cleanup tool — surface the rows for an admin to handle
 *  in PCO directly, don't try to auto-fix anything here. */
export function auditMembershipType(
  orgId: number,
  membershipType: string,
): AuditResult {
  const db = getDb();
  const sixMonthsAgo = new Date(Date.now() - 180 * MS_PER_DAY).toISOString();
  const oneYearAgo = new Date(Date.now() - 365 * MS_PER_DAY).toISOString();
  const recentCheckinCutoff = new Date(
    Date.now() - 90 * MS_PER_DAY,
  ).toISOString();

  // Per-person aggregates in a single query — three correlated subqueries
  // would be slow over 1k+ Members.
  const rawRows = db
    .prepare(
      `WITH grp AS (
         SELECT person_id, COUNT(DISTINCT group_id) AS n
           FROM pco_group_memberships
          WHERE org_id = ? AND archived_at IS NULL
          GROUP BY person_id
       ),
       tm AS (
         SELECT person_id, COUNT(DISTINCT team_id) AS n
           FROM pco_team_memberships
          WHERE org_id = ? AND archived_at IS NULL AND person_id != ''
          GROUP BY person_id
       ),
       ci AS (
         SELECT person_id, COUNT(*) AS n
           FROM pco_check_ins
          WHERE org_id = ? AND person_id IS NOT NULL
            AND pco_created_at >= ?
          GROUP BY person_id
       )
       SELECT
         p.pco_id           AS pcoId,
         p.enc_pii          AS encPii,
         p.membership_type  AS membershipType,
         p.status           AS status,
         p.is_minor         AS isMinor,
         p.pco_created_at   AS pcoCreatedAt,
         p.pco_updated_at   AS pcoUpdatedAt,
         p.inactivated_at   AS inactivatedAt,
         COALESCE(grp.n, 0) AS groupsCount,
         COALESCE(tm.n, 0)  AS teamsCount,
         COALESCE(ci.n, 0)  AS recentCheckins
       FROM pco_people p
       LEFT JOIN grp ON grp.person_id = p.pco_id
       LEFT JOIN tm  ON tm.person_id  = p.pco_id
       LEFT JOIN ci  ON ci.person_id  = p.pco_id
      WHERE p.org_id = ?
        AND p.membership_type = ?
      ORDER BY p.pco_id`,
    )
    .all(orgId, orgId, orgId, recentCheckinCutoff, orgId, membershipType) as Array<{
    pcoId: string;
    encPii: string | null;
    membershipType: string | null;
    status: string | null;
    isMinor: number;
    pcoCreatedAt: string | null;
    pcoUpdatedAt: string | null;
    inactivatedAt: string | null;
    groupsCount: number;
    teamsCount: number;
    recentCheckins: number;
  }>;

  // First pass — decrypt + collect; second pass for duplicate detection.
  const piiById = new Map<string, { first: string | null; last: string | null }>();
  for (const r of rawRows) {
    if (r.encPii) {
      const pii = decryptJson<PIIBlob>(r.encPii);
      piiById.set(r.pcoId, {
        first: pii?.first_name?.trim() ?? null,
        last: pii?.last_name?.trim() ?? null,
      });
    } else {
      piiById.set(r.pcoId, { first: null, last: null });
    }
  }

  // Possible-duplicate index: lower-case "first last".
  const nameKeyCount = new Map<string, number>();
  for (const [, pii] of piiById) {
    if (!pii.first || !pii.last) continue;
    const key = `${pii.first} ${pii.last}`.toLowerCase();
    nameKeyCount.set(key, (nameKeyCount.get(key) ?? 0) + 1);
  }

  const rows: AuditRow[] = [];
  const flagCounts: Record<AuditFlag, number> = {
    deceased: 0,
    inactive: 0,
    "junk-name": 0,
    "weird-name": 0,
    "no-birthdate": 0,
    "possible-duplicate": 0,
    "stale-pco-record": 0,
    "no-activity-no-rosters": 0,
  };

  for (const r of rawRows) {
    const pii = piiById.get(r.pcoId) ?? { first: null, last: null };
    const first = pii.first;
    const last = pii.last;
    const fullName =
      [first, last].filter(Boolean).join(" ") || `(unknown #${r.pcoId})`;
    const initials =
      ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??";

    const flags: AuditFlag[] = [];

    // Deceased — PCO doesn't have a deceased status by default, but
    // churches commonly stash this in the status field or the name
    // ("Smith - DECEASED").
    const statusLower = (r.status ?? "").toLowerCase();
    const nameJoinedLower = `${first ?? ""} ${last ?? ""}`.toLowerCase();
    if (
      statusLower.includes("deceased") ||
      nameJoinedLower.includes("deceased") ||
      nameJoinedLower.includes("(d)") ||
      nameJoinedLower.includes("[deceased]")
    ) {
      flags.push("deceased");
    }

    // Inactive — explicit PCO inactive status, or an inactivated_at on
    // the row, or no activity for 365+ days with no group/team/check-in.
    if (
      statusLower === "inactive" ||
      r.inactivatedAt ||
      (r.pcoUpdatedAt &&
        r.pcoUpdatedAt < oneYearAgo &&
        r.groupsCount === 0 &&
        r.teamsCount === 0 &&
        r.recentCheckins === 0)
    ) {
      flags.push("inactive");
    }

    // Junk name — empty / only-punctuation / starts with non-letter.
    if (!first && !last) {
      flags.push("junk-name");
    } else if (isJunkNameLocal(first) || isJunkNameLocal(last)) {
      flags.push("junk-name");
    } else {
      // Weird-but-not-junk: contains digits, very short single letters,
      // ALL-CAPS room codes that snuck past the junk filter, repeated
      // characters ("Aaaaaa"), single-character names.
      const combo = `${first ?? ""}${last ?? ""}`;
      if (
        /\d/.test(combo) ||
        (first && first.length <= 1) ||
        (last && last.length <= 1) ||
        /(.)\1{3,}/i.test(combo)
      ) {
        flags.push("weird-name");
      }
    }

    // No birthdate — info-only flag, useful for visibility.
    // (is_minor is the denormalized flag; absent birth_year is the
    // signal of an unknown DOB.)
    if (!r.isMinor) {
      // Check enc_pii for the birthdate field.
      const piiFull = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
      if (!piiFull?.birthdate) flags.push("no-birthdate");
    }

    // Possible duplicate — name collides with another person in this
    // membership-type pool.
    if (first && last) {
      const key = `${first} ${last}`.toLowerCase();
      if ((nameKeyCount.get(key) ?? 0) > 1) {
        flags.push("possible-duplicate");
      }
    }

    // Stale PCO record — no edit in 6mo. Less severe than inactive but
    // still worth flagging on a member roster.
    if (
      r.pcoUpdatedAt &&
      r.pcoUpdatedAt < sixMonthsAgo &&
      !flags.includes("inactive")
    ) {
      flags.push("stale-pco-record");
    }

    // No activity AND no rosters — a "Member" but not in groups, not
    // serving, not checking in. Worth a pastoral conversation.
    if (
      r.groupsCount === 0 &&
      r.teamsCount === 0 &&
      r.recentCheckins === 0 &&
      !flags.includes("inactive")
    ) {
      flags.push("no-activity-no-rosters");
    }

    for (const f of flags) flagCounts[f]++;

    rows.push({
      pcoId: r.pcoId,
      fullName,
      initials,
      membershipType: r.membershipType,
      status: r.status,
      isMinor: r.isMinor === 1,
      pcoCreatedAt: r.pcoCreatedAt,
      pcoUpdatedAt: r.pcoUpdatedAt,
      inactivatedAt: r.inactivatedAt,
      groupsCount: r.groupsCount,
      teamsCount: r.teamsCount,
      recentCheckins: r.recentCheckins,
      flags,
    });
  }

  // Bubble flagged rows to the top; flagged-with-most-flags first.
  rows.sort((a, b) => {
    if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
    return a.fullName.localeCompare(b.fullName);
  });

  return {
    membershipType,
    rows,
    flagCounts,
    totalScanned: rawRows.length,
  };
}

function isJunkNameLocal(name: string | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if (!/\p{L}/u.test(trimmed)) return true;
  if (!/^\p{L}/u.test(trimmed)) return true;
  return false;
}
