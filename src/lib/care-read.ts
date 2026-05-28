import "server-only";
import { getDb } from "./db";
import { decryptJson } from "./encryption";
import { getExcludedMembershipTypes, getSyncSettings } from "./pco";
import { populateShepherdedTempTable } from "./people-read";

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

/** Active = recent form submission or check-in. Present = no recent
 *  activity but the PCO record itself was touched in-window. Both are
 *  "not shepherded" by construction on this page. */
export type CareClassification = "active" | "present";

export interface CareCandidate {
  personId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  isMinor: boolean;
  classification: CareClassification;
}

export interface CareRosterPerson {
  assignmentId: number;
  personId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  isMinor: boolean;
  note: string | null;
  createdAt: string;
}

export interface CareCoverage {
  unassigned: number;
  assigned: number;
  /** Whether the present tier was included in `unassigned`. */
  includesPresent: boolean;
}

function nameParts(encPii: string | null): {
  fullName: string;
  initials: string;
} {
  const pii = encPii ? decryptJson<PIIBlob>(encPii) : null;
  const first = pii?.first_name ?? null;
  const last = pii?.last_name ?? null;
  const fullName = [first, last].filter(Boolean).join(" ") || "(unknown)";
  const initials =
    ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??";
  return { fullName, initials };
}

function activityCutoff(orgId: number): string {
  const months = getSyncSettings(orgId).activityTrackingMonths;
  return new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString();
}

interface CandidateRawRow {
  pco_id: string;
  enc_pii: string | null;
  membership_type: string | null;
  is_minor: number;
  last_form_submission_at: string | null;
  last_check_in_at: string | null;
  pco_updated_at: string | null;
}

/** People who need a carer: not shepherded, not already on anyone's
 *  care roster, and either Active (default) or Active-or-Present when
 *  `includePresent` is set. Excluded membership types are dropped to
 *  match the rest of the app. */
export function listCareCandidates(
  orgId: number,
  includePresent: boolean,
): CareCandidate[] {
  const db = getDb();
  populateShepherdedTempTable(orgId);
  const cutoff = activityCutoff(orgId);
  const excluded = getExcludedMembershipTypes(orgId);

  const args: (string | number)[] = [orgId, orgId];
  // Active = form submission or check-in in-window.
  let predicate = `((p.last_form_submission_at IS NOT NULL AND p.last_form_submission_at >= ?)
       OR (p.last_check_in_at IS NOT NULL AND p.last_check_in_at >= ?))`;
  args.push(cutoff, cutoff);
  if (includePresent) {
    // Union with Present — a record edited in-window. (Active people
    // may or may not also satisfy this; the OR covers both tiers.)
    predicate = `(${predicate}
       OR (p.pco_updated_at IS NOT NULL AND p.pco_updated_at >= ?))`;
    args.push(cutoff);
  }

  let excludeSql = "";
  if (excluded.length > 0) {
    const ph = excluded.map(() => "?").join(",");
    excludeSql = `AND (p.membership_type IS NULL OR p.membership_type NOT IN (${ph}))`;
    args.push(...excluded);
  }

  const rows = db
    .prepare(
      `SELECT p.pco_id, p.enc_pii, p.membership_type, p.is_minor,
              p.last_form_submission_at, p.last_check_in_at, p.pco_updated_at
         FROM pco_people p
         LEFT JOIN temp.shep_set s ON s.person_id = p.pco_id
        WHERE p.org_id = ?
          AND s.person_id IS NULL
          AND p.is_minor = 0
          AND p.pco_id NOT IN (
            SELECT person_id FROM care_assignments WHERE org_id = ?
          )
          AND ${predicate}
          ${excludeSql}`,
    )
    .all(...args) as CandidateRawRow[];

  const out: CareCandidate[] = rows.map((r) => {
    const { fullName, initials } = nameParts(r.enc_pii);
    const isActive =
      (r.last_form_submission_at !== null &&
        r.last_form_submission_at >= cutoff) ||
      (r.last_check_in_at !== null && r.last_check_in_at >= cutoff);
    return {
      personId: r.pco_id,
      fullName,
      initials,
      membershipType: r.membership_type,
      isMinor: r.is_minor === 1,
      classification: isActive ? "active" : "present",
    };
  });
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}

/** Current care rosters, keyed by shepherd person id. People who have
 *  since become shepherded are filtered out — they no longer need a
 *  manual touch point, so they silently leave every roster. */
export function listCareAssignments(
  orgId: number,
): Map<string, CareRosterPerson[]> {
  const db = getDb();
  populateShepherdedTempTable(orgId);
  const rows = db
    .prepare(
      `SELECT ca.id, ca.shepherd_person_id AS shepherdPersonId,
              ca.person_id AS personId, ca.note, ca.created_at AS createdAt,
              p.enc_pii AS encPii, p.membership_type AS membershipType,
              p.is_minor AS isMinor
         FROM care_assignments ca
         JOIN pco_people p
           ON p.org_id = ca.org_id AND p.pco_id = ca.person_id
         LEFT JOIN temp.shep_set s ON s.person_id = ca.person_id
        WHERE ca.org_id = ?
          AND s.person_id IS NULL
          AND p.is_minor = 0
        ORDER BY ca.created_at DESC`,
    )
    .all(orgId) as Array<{
    id: number;
    shepherdPersonId: string;
    personId: string;
    note: string | null;
    createdAt: string;
    encPii: string | null;
    membershipType: string | null;
    isMinor: number;
  }>;

  const byShepherd = new Map<string, CareRosterPerson[]>();
  for (const r of rows) {
    const { fullName, initials } = nameParts(r.encPii);
    const arr = byShepherd.get(r.shepherdPersonId) ?? [];
    arr.push({
      assignmentId: r.id,
      personId: r.personId,
      fullName,
      initials,
      membershipType: r.membershipType,
      isMinor: r.isMinor === 1,
      note: r.note,
      createdAt: r.createdAt,
    });
    byShepherd.set(r.shepherdPersonId, arr);
  }
  // Alphabetize each roster.
  for (const arr of byShepherd.values()) {
    arr.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  return byShepherd;
}

/** Hard-delete care rows for people who are now shepherded. Read paths
 *  already hide them; this keeps the table from accumulating dead rows.
 *  Called from the care-map server actions. */
export function pruneShepherdedCareAssignments(orgId: number): void {
  const db = getDb();
  populateShepherdedTempTable(orgId);
  db.prepare(
    `DELETE FROM care_assignments
      WHERE org_id = ?
        AND person_id IN (SELECT person_id FROM temp.shep_set)`,
  ).run(orgId);
}

/** Headline counts for the page — assigned excludes shepherded rows so
 *  it matches what the rosters actually show. */
export function getCareCoverage(
  orgId: number,
  includePresent: boolean,
): CareCoverage {
  const candidates = listCareCandidates(orgId, includePresent);
  let assigned = 0;
  for (const arr of listCareAssignments(orgId).values()) assigned += arr.length;
  return {
    unassigned: candidates.length,
    assigned,
    includesPresent: includePresent,
  };
}

/** Total people who could land on a care roster — not shepherded
 *  (no active group / team), not a minor, and engaged in SOME way
 *  in the activity window (form submission, check-in, OR a recent
 *  PCO record update — matching the broader "active + present"
 *  classification rather than the narrower "active = form/check-in"
 *  rule the rest of /care-map's candidate list already uses).
 *
 *  Used as the "Even split per shepherd" denominator so a pastor
 *  sees what the load would look like if every non-shepherded
 *  engaged adult had a touch point — not just the form-submitters. */
export function countActiveNotShepherded(orgId: number): number {
  const db = getDb();
  populateShepherdedTempTable(orgId);
  const cutoff = activityCutoff(orgId);
  const excluded = getExcludedMembershipTypes(orgId);
  const args: (string | number)[] = [orgId, cutoff, cutoff, cutoff];
  let excludeSql = "";
  if (excluded.length > 0) {
    const ph = excluded.map(() => "?").join(",");
    excludeSql = `AND (p.membership_type IS NULL OR p.membership_type NOT IN (${ph}))`;
    args.push(...excluded);
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM pco_people p
         LEFT JOIN temp.shep_set s ON s.person_id = p.pco_id
        WHERE p.org_id = ?
          AND s.person_id IS NULL
          AND p.is_minor = 0
          AND ((p.last_form_submission_at IS NOT NULL AND p.last_form_submission_at >= ?)
            OR (p.last_check_in_at IS NOT NULL AND p.last_check_in_at >= ?)
            OR (p.pco_updated_at IS NOT NULL AND p.pco_updated_at >= ?))
          ${excludeSql}`,
    )
    .get(...args) as { n: number };
  return row.n;
}
