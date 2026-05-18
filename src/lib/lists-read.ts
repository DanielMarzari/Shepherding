import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export interface ListPersonRow {
  personId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  isMinor: boolean;
  isParent: boolean;
  birthYear: number | null;
}

export interface ListSummary {
  pcoId: string;
  name: string;
  description: string | null;
  totalPeople: number;
  refreshedAt: string | null;
  members: ListPersonRow[];
}

/** Fetch a single REFERENCE list (by exact name) plus its member set
 *  with decrypted names + a few demographic flags for the table. */
export function getListByName(
  orgId: number,
  name: string,
): ListSummary | null {
  const db = getDb();
  const list = db
    .prepare(
      `SELECT pco_id, name, description, total_people, refreshed_at
         FROM pco_lists
        WHERE org_id = ? AND name = ?
        LIMIT 1`,
    )
    .get(orgId, name) as
    | {
        pco_id: string;
        name: string;
        description: string | null;
        total_people: number | null;
        refreshed_at: string | null;
      }
    | undefined;
  if (!list) return null;

  const rows = db
    .prepare(
      `SELECT
         p.pco_id          AS personId,
         p.enc_pii         AS encPii,
         p.membership_type AS membershipType,
         p.is_minor        AS isMinor,
         p.is_parent       AS isParent,
         p.birth_year      AS birthYear
       FROM pco_list_memberships m
       JOIN pco_people p
         ON p.org_id = m.org_id AND p.pco_id = m.person_id
       WHERE m.org_id = ? AND m.list_id = ?
       ORDER BY p.pco_updated_at DESC NULLS LAST`,
    )
    .all(orgId, list.pco_id) as Array<{
    personId: string;
    encPii: string | null;
    membershipType: string | null;
    isMinor: number;
    isParent: number;
    birthYear: number | null;
  }>;

  const members: ListPersonRow[] = rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const firstName = pii?.first_name ?? null;
    const lastName = pii?.last_name ?? null;
    const fullName =
      [firstName, lastName].filter(Boolean).join(" ") ||
      `(unknown #${r.personId})`;
    const initials =
      ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "??";
    return {
      personId: r.personId,
      fullName,
      initials,
      membershipType: r.membershipType,
      isMinor: r.isMinor === 1,
      isParent: r.isParent === 1,
      birthYear: r.birthYear,
    };
  });
  // Alphabetical by last name once we have decrypted names.
  members.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return {
    pcoId: list.pco_id,
    name: list.name,
    description: list.description,
    totalPeople: list.total_people ?? members.length,
    refreshedAt: list.refreshed_at,
    members,
  };
}

/** All synced REFERENCE list names (for /pco filter UI later or as a
 *  fallback). */
export function listReferenceListNames(orgId: number): string[] {
  return (
    getDb()
      .prepare(
        "SELECT name FROM pco_lists WHERE org_id = ? ORDER BY name ASC",
      )
      .all(orgId) as Array<{ name: string }>
  ).map((r) => r.name);
}
