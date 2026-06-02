import "server-only";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { decryptJson, hmac, sign, verifySigned } from "./encryption";
import { SHEPHERD_TEAM_LIST_NAME } from "./assignments-read";

const INTAKE_COOKIE = "shepherd_intake";
const INTAKE_DAYS = 30;

interface PIIBlob {
  first_name?: string | null;
  last_name?: string | null;
}

export interface IntakeSession {
  orgId: number;
  personId: string;
  fullName: string;
  initials: string;
}

function personName(orgId: number, personId: string): {
  fullName: string;
  initials: string;
} {
  const row = getDb()
    .prepare(`SELECT enc_pii FROM pco_people WHERE org_id = ? AND pco_id = ?`)
    .get(orgId, personId) as { enc_pii: string | null } | undefined;
  const pii = row?.enc_pii ? decryptJson<PIIBlob>(row.enc_pii) : null;
  const first = pii?.first_name ?? null;
  const last = pii?.last_name ?? null;
  return {
    fullName: [first, last].filter(Boolean).join(" ") || `(unknown #${personId})`,
    initials: ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??",
  };
}

/** Match an email to a shepherd-team member. Hashes the address (we
 *  never store plaintext), finds people with that email hash across
 *  all orgs, then keeps only those on that org's "REFERENCE - Shepherd
 *  Team" list. Returns the single match, or a reason it failed:
 *   - "none"      → no shepherd-team member has that email
 *   - "ambiguous" → the email maps to more than one shepherd-team
 *                   member (shared family address); admin must sort it. */
export function matchShepherdByEmail(
  email: string,
):
  | { ok: true; orgId: number; personId: string }
  | { ok: false; reason: "none" | "ambiguous" } {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { ok: false, reason: "none" };
  const h = hmac(normalized);
  const rows = getDb()
    .prepare(
      `SELECT pe.org_id AS orgId, pe.person_id AS personId
         FROM pco_person_emails pe
         JOIN pco_list_memberships m
           ON m.org_id = pe.org_id AND m.person_id = pe.person_id
         JOIN pco_lists l
           ON l.org_id = m.org_id AND l.pco_id = m.list_id
        WHERE pe.email_hash = ?
          AND l.name = ?`,
    )
    .all(h, SHEPHERD_TEAM_LIST_NAME) as Array<{
    orgId: number;
    personId: string;
  }>;
  // De-dup (a person could be on the list via multiple membership rows).
  const uniq = new Map<string, { orgId: number; personId: string }>();
  for (const r of rows) uniq.set(`${r.orgId}:${r.personId}`, r);
  const matches = [...uniq.values()];
  if (matches.length === 0) return { ok: false, reason: "none" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, orgId: matches[0].orgId, personId: matches[0].personId };
}

export async function createIntakeSession(
  orgId: number,
  personId: string,
): Promise<void> {
  const exp = Date.now() + INTAKE_DAYS * 24 * 60 * 60 * 1000;
  const token = sign(`${orgId}:${personId}:${exp}`);
  const store = await cookies();
  store.set(INTAKE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: INTAKE_DAYS * 24 * 60 * 60,
  });
}

export async function destroyIntakeSession(): Promise<void> {
  const store = await cookies();
  store.delete(INTAKE_COOKIE);
}

export async function getIntakeSession(): Promise<IntakeSession | null> {
  const store = await cookies();
  const value = verifySigned(store.get(INTAKE_COOKIE)?.value);
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const orgId = Number(parts[0]);
  const personId = parts[1];
  const exp = Number(parts[2]);
  if (!Number.isFinite(orgId) || !personId || !Number.isFinite(exp)) {
    return null;
  }
  if (Date.now() > exp) return null;
  // Re-verify the person is STILL on the shepherd team — revoked
  // access takes effect on next page load, not just at login.
  const stillOnTeam = getDb()
    .prepare(
      `SELECT 1 FROM pco_list_memberships m
         JOIN pco_lists l ON l.org_id = m.org_id AND l.pco_id = m.list_id
        WHERE m.org_id = ? AND m.person_id = ? AND l.name = ?
        LIMIT 1`,
    )
    .get(orgId, personId, SHEPHERD_TEAM_LIST_NAME);
  if (!stillOnTeam) return null;
  const { fullName, initials } = personName(orgId, personId);
  return { orgId, personId, fullName, initials };
}

// ─── Candidates + "known" marks ───────────────────────────────────

export interface IntakeCandidate {
  personId: string;
  fullName: string;
  /** Surname, for last-name sorting and the A-Z jump rail. */
  lastName: string;
  initials: string;
  known: boolean;
}

/** Active-adult population the shepherd can mark, with whether THIS
 *  shepherd has already marked each as known. Deliberately does NOT
 *  exclude people already on a care roster — knowing someone is a
 *  separate signal from being assigned them, and a shepherd may know
 *  people assigned elsewhere. Reads person_activity (the shared
 *  classification) so "active" matches the rest of the app. */
export function listIntakeCandidates(
  orgId: number,
  shepherdPersonId: string,
): IntakeCandidate[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.pco_id AS personId, p.enc_pii AS encPii,
              CASE WHEN k.person_id IS NOT NULL THEN 1 ELSE 0 END AS known
         FROM person_activity pa
         JOIN pco_people p
           ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
         LEFT JOIN shepherd_known_people k
           ON k.org_id = pa.org_id
          AND k.shepherd_person_id = ?
          AND k.person_id = pa.person_id
        WHERE pa.org_id = ?
          -- JUST 'active' — matches the "Active" count on /people.
          -- Not 'present' (PCO record merely edited) and not
          -- 'shepherded' (already in a group/team).
          AND pa.classification = 'active'
          AND p.is_minor = 0
          AND p.pco_id != ?
          -- PCO-inactive is ALWAYS inactive for us. Checked directly
          -- here (not just via pa.classification) so it's correct even
          -- before the next snapshot rebuild applies the same override.
          AND lower(coalesce(p.status,'')) != 'inactive'
          AND p.inactivated_at IS NULL`,
    )
    .all(shepherdPersonId, orgId, shepherdPersonId) as Array<{
    personId: string;
    encPii: string | null;
    known: number;
  }>;
  const out = rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const first = pii?.first_name ?? null;
    const last = pii?.last_name ?? null;
    return {
      personId: r.personId,
      fullName:
        [first, last].filter(Boolean).join(" ") || `(unknown #${r.personId})`,
      lastName: (last ?? first ?? "").trim(),
      initials: ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??",
      known: r.known === 1,
    };
  });
  // Marked-known first, then by last name — so a returning shepherd
  // sees their picks at the top.
  out.sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1;
    return a.lastName.localeCompare(b.lastName) || a.fullName.localeCompare(b.fullName);
  });
  return out;
}

export function setKnown(
  orgId: number,
  shepherdPersonId: string,
  personId: string,
  known: boolean,
): void {
  const db = getDb();
  if (known) {
    db.prepare(
      `INSERT OR IGNORE INTO shepherd_known_people
         (org_id, shepherd_person_id, person_id)
       VALUES (?, ?, ?)`,
    ).run(orgId, shepherdPersonId, personId);
  } else {
    db.prepare(
      `DELETE FROM shepherd_known_people
        WHERE org_id = ? AND shepherd_person_id = ? AND person_id = ?`,
    ).run(orgId, shepherdPersonId, personId);
  }
}

export interface KnownMark {
  shepherdPersonId: string;
  shepherdName: string;
}

/** For the admin care map: who has marked they know each person.
 *  Returns Map<personId, KnownMark[]>. */
export function listKnownMarksByPerson(
  orgId: number,
): Map<string, KnownMark[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT k.person_id AS personId,
              k.shepherd_person_id AS shepherdPersonId,
              sp.enc_pii AS encPii
         FROM shepherd_known_people k
         LEFT JOIN pco_people sp
           ON sp.org_id = k.org_id AND sp.pco_id = k.shepherd_person_id
        WHERE k.org_id = ?`,
    )
    .all(orgId) as Array<{
    personId: string;
    shepherdPersonId: string;
    encPii: string | null;
  }>;
  const out = new Map<string, KnownMark[]>();
  for (const r of rows) {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const name =
      [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") ||
      `(unknown #${r.shepherdPersonId})`;
    const arr = out.get(r.personId) ?? [];
    arr.push({ shepherdPersonId: r.shepherdPersonId, shepherdName: name });
    out.set(r.personId, arr);
  }
  return out;
}
