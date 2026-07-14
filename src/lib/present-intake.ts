import "server-only";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { decryptJson, hmac, sign, verifySigned } from "./encryption";
import { getExcludedMembershipTypes } from "./pco";
import { setKnown, type IntakeCandidate } from "./shepherd-intake";

// A second, temporary shepherd-intake page — same flow as /know, but it lists
// people classified 'present' (not 'active'), and only a hard-wired allowlist of
// people may use it. Kept fully separate from /know (its own cookie).

const PRESENT_COOKIE = "present_intake";
const PRESENT_DAYS = 30;

interface PIIBlob { first_name?: string | null; last_name?: string | null }

// Allowlist — matched leniently (last name + first-name prefix) since we key off
// the decrypted PII. Temporary; hard-wired per request.
const ALLOW: Array<{ first: string; last: string }> = [
  { first: "jo", last: "henseler" }, // Joe Henseler
  { first: "mic", last: "whitehead" }, // Michal Whitehead
  { first: "greg", last: "wollenhaupt" }, // Greg Wollenhaupt
  { first: "dav", last: "peters" }, // Dave Peters
  { first: "dan", last: "marzari" }, // Daniel Marzari
];
function isAllowed(first: string | null | undefined, last: string | null | undefined): boolean {
  const f = (first ?? "").trim().toLowerCase();
  const l = (last ?? "").trim().toLowerCase();
  return ALLOW.some((a) => l === a.last && f.startsWith(a.first));
}
function piiOf(orgId: number, personId: string): PIIBlob | null {
  const row = getDb().prepare("SELECT enc_pii FROM pco_people WHERE org_id = ? AND pco_id = ?").get(orgId, personId) as { enc_pii: string | null } | undefined;
  return row?.enc_pii ? decryptJson<PIIBlob>(row.enc_pii) : null;
}

export function matchPresentByEmail(
  email: string,
): { ok: true; orgId: number; personId: string } | { ok: false; reason: "none" | "not_allowed" | "ambiguous" } {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { ok: false, reason: "none" };
  const rows = getDb()
    .prepare("SELECT org_id AS orgId, person_id AS personId FROM pco_person_emails WHERE email_hash = ?")
    .all(hmac(normalized)) as Array<{ orgId: number; personId: string }>;
  if (rows.length === 0) return { ok: false, reason: "none" };
  const uniq = new Map<string, { orgId: number; personId: string }>();
  for (const r of rows) {
    const pii = piiOf(r.orgId, r.personId);
    if (isAllowed(pii?.first_name, pii?.last_name)) uniq.set(`${r.orgId}:${r.personId}`, r);
  }
  const list = [...uniq.values()];
  if (list.length === 0) return { ok: false, reason: "not_allowed" };
  if (list.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, orgId: list[0].orgId, personId: list[0].personId };
}

export interface PresentSession { orgId: number; personId: string; fullName: string }

export async function createPresentSession(orgId: number, personId: string): Promise<void> {
  const exp = Date.now() + PRESENT_DAYS * 24 * 60 * 60 * 1000;
  const store = await cookies();
  store.set(PRESENT_COOKIE, sign(`${orgId}:${personId}:${exp}`), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PRESENT_DAYS * 24 * 60 * 60,
  });
}

export async function destroyPresentSession(): Promise<void> {
  (await cookies()).delete(PRESENT_COOKIE);
}

export async function getPresentSession(): Promise<PresentSession | null> {
  const value = verifySigned((await cookies()).get(PRESENT_COOKIE)?.value);
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const orgId = Number(parts[0]);
  const personId = parts[1];
  const exp = Number(parts[2]);
  if (!Number.isFinite(orgId) || !personId || !Number.isFinite(exp) || Date.now() > exp) return null;
  const pii = piiOf(orgId, personId);
  if (!isAllowed(pii?.first_name, pii?.last_name)) return null; // revoked access takes effect on next load
  return { orgId, personId, fullName: [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") || `(#${personId})` };
}

/** Marks stored under the 'present' source so /know and /present stay separate. */
export function setKnownPresent(orgId: number, shepherdPersonId: string, personId: string, known: boolean): void {
  setKnown(orgId, shepherdPersonId, personId, known, "present");
}

/** 'present' adults the person can mark — mirrors listIntakeCandidates but for
 *  classification = 'present' instead of 'active'. */
export function listPresentCandidates(orgId: number, viewerPersonId: string): IntakeCandidate[] {
  // Honor the Filters config — e.g. the "SYSTEM USE - Do Not Delete" membership
  // type — so system accounts never appear here.
  const excludedMem = getExcludedMembershipTypes(orgId);
  const memClause = excludedMem.length
    ? `AND (p.membership_type IS NULL OR p.membership_type NOT IN (${excludedMem.map(() => "?").join(",")}))`
    : "";
  const rows = getDb()
    .prepare(
      `SELECT p.pco_id AS personId, p.enc_pii AS encPii,
              CASE WHEN k.person_id IS NOT NULL THEN 1 ELSE 0 END AS known,
              (SELECT hm.household_id FROM pco_household_memberships hm
                WHERE hm.org_id = p.org_id AND hm.person_id = p.pco_id LIMIT 1) AS householdId
         FROM person_activity pa
         JOIN pco_people p ON p.org_id = pa.org_id AND p.pco_id = pa.person_id
         LEFT JOIN shepherd_known_people k
           ON k.org_id = pa.org_id AND k.shepherd_person_id = ? AND k.person_id = pa.person_id AND k.source = 'present'
        WHERE pa.org_id = ?
          AND pa.classification = 'present'
          AND p.is_minor = 0
          AND p.pco_id != ?
          AND lower(coalesce(p.status,'')) != 'inactive'
          AND p.inactivated_at IS NULL ${memClause}`,
    )
    .all(viewerPersonId, orgId, viewerPersonId, ...excludedMem) as Array<{ personId: string; encPii: string | null; known: number; householdId: string | null }>;
  const out = rows.map((r) => {
    const pii = r.encPii ? decryptJson<PIIBlob>(r.encPii) : null;
    const first = pii?.first_name ?? null;
    const last = pii?.last_name ?? null;
    return {
      personId: r.personId,
      fullName: [first, last].filter(Boolean).join(" ") || `(unknown #${r.personId})`,
      lastName: (last ?? first ?? "").trim(),
      initials: ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??",
      known: r.known === 1,
      householdId: r.householdId,
    };
  });
  out.sort((a, b) => (a.known !== b.known ? (a.known ? -1 : 1) : a.lastName.localeCompare(b.lastName) || a.fullName.localeCompare(b.fullName)));
  return out;
}
