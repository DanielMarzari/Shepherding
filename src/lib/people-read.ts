import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";

export type ActivityClassification = "active" | "present" | "inactive";

export interface SyncedPersonRow {
  pcoId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  initials: string;
  birthdate: string | null;
  address: string | null;
  gender: string | null;
  membershipType: string | null;
  maritalStatus: string | null;
  pcoStatus: string | null;
  pcoCreatedAt: string | null;
  pcoUpdatedAt: string | null;
  inactivatedAt: string | null;
  lastActivityAt: string | null;
  classification: ActivityClassification;
  /** True if PCO marked them inactive (admin action), independent of our
   *  computed classification. */
  pcoInactive: boolean;
}

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
  birthdate?: string | null;
  address?: string | null;
}

interface RawRow {
  pco_id: string;
  enc_pii: string | null;
  gender: string | null;
  membership_type: string | null;
  marital_status: string | null;
  status: string | null;
  pco_created_at: string | null;
  pco_updated_at: string | null;
  inactivated_at: string | null;
  last_activity_at: string | null;
}

function classify(
  lastActivityAt: string | null,
  pcoCreatedAt: string | null,
  activityMonths: number,
): ActivityClassification {
  const cutoff = new Date(
    Date.now() - activityMonths * 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const recent = !!lastActivityAt && lastActivityAt >= cutoff;
  if (recent) return "active";
  // Not recently active. Were they created in the last X months?
  const createdRecent = !!pcoCreatedAt && pcoCreatedAt >= cutoff;
  return createdRecent ? "present" : "inactive";
}

function toRow(r: RawRow, activityMonths: number): SyncedPersonRow {
  const pii = decryptJson<PIIBlob>(r.enc_pii) ?? {};
  const firstName = pii.first_name ?? null;
  const lastName = pii.last_name ?? null;
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") || `(unknown #${r.pco_id})`;
  const initials = ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "??";
  return {
    pcoId: r.pco_id,
    firstName,
    lastName,
    fullName,
    initials,
    birthdate: pii.birthdate ?? null,
    address: pii.address ?? null,
    gender: r.gender,
    membershipType: r.membership_type,
    maritalStatus: r.marital_status,
    pcoStatus: r.status,
    pcoCreatedAt: r.pco_created_at,
    pcoUpdatedAt: r.pco_updated_at,
    inactivatedAt: r.inactivated_at,
    lastActivityAt: r.last_activity_at,
    classification: classify(r.last_activity_at, r.pco_created_at, activityMonths),
    pcoInactive: r.status === "inactive" || !!r.inactivated_at,
  };
}

export function listPeople(
  orgId: number,
  activityMonths: number,
): SyncedPersonRow[] {
  const rows = getDb()
    .prepare(
      `SELECT pco_id, enc_pii, gender, membership_type, marital_status, status,
              pco_created_at, pco_updated_at, inactivated_at, last_activity_at
         FROM pco_people
         WHERE org_id = ?
         ORDER BY last_activity_at DESC NULLS LAST`,
    )
    .all(orgId) as RawRow[];
  return rows.map((r) => toRow(r, activityMonths));
}

export interface ClassificationCounts {
  total: number;
  active: number;
  present: number;
  inactive: number;
  shepherded: number;
}

export function getClassificationCounts(
  orgId: number,
  activityMonths: number,
): ClassificationCounts {
  const all = listPeople(orgId, activityMonths);
  const counts = {
    total: all.length,
    active: 0,
    present: 0,
    inactive: 0,
    // Shepherded requires group/team membership data which isn't synced yet.
    // Reserve the slot; report 0 with a UI footnote until that lands.
    shepherded: 0,
  };
  for (const p of all) {
    counts[p.classification]++;
  }
  return counts;
}
