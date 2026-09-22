import "server-only";
import { getDb } from "./db";
import { decryptJson, encryptJson, hmac } from "./encryption";
import { firstNameSimilar, normNamePart, fullNameKey, organizationKey, looksLikeOrgName } from "./name-match";
import { normPhone } from "./phone";

// PushPay giving import + person matching. No API — an admin uploads the
// "All Donors" CSV export. Donor PII is encrypted at rest; only keyed HMAC
// tokens are kept for matching (same approach as pco_person_emails). Matching
// combines three one-way signals — normalized name, email hash, and phone
// hash: anyone confirmed by two signals wins outright; a lone unique signal
// still matches; when signals point at several people (shared household email,
// same-name pair) the donor is flagged ambiguous for manual reconciliation.

interface PII { first_name?: string | null; last_name?: string | null }
interface DonorPII { firstName: string; lastName: string; email: string; phone: string }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Lowercased "first last", punctuation + generational suffixes stripped, and
 *  dashes/underscores treated as spaces so org-name variants line up
 *  ("grace-church" = "grace_church" = "grace church", and a leading "_"
 *  placeholder first name drops out). */
function normName(first: string, last: string): string {
  return `${first} ${last}`
    .toLowerCase()
    .replace(/[.,'`]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "31-Aug-26" → "2026-08-31". */
function parseDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${2000 + parseInt(m[3], 10)}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Minimal quote-aware CSV parser → rows of string cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export interface PushpayImportResult { total: number; matched: number; ambiguous: number; unmatched: number }

interface MatchIndexes {
  /** Normalized last name → the people with it (first/last kept so we can
   *  judge nicknames). Name agreement is MANDATORY, so this is the entry
   *  point for finding candidates — email/phone only add confidence. */
  byLast: Map<string, Array<{ id: string; first: string; last: string }>>;
  /** Whole-name key → people, so a differently-split name still matches. */
  byFullName: Map<string, string[]>;
  /** Organization name → the org records filed under it. Organizations have no
   *  first name to agree on, so they're matched on the name alone. */
  byOrg: Map<string, string[]>;
  email: Map<string, string[]>;
  phone: Map<string, string[]>;
  /** Per-person contact hashes + birth year, used to tell whether two tied
   *  candidates are duplicate records of one person (safe to pick either) or
   *  genuinely two different people (must ask). */
  emailsOf: Map<string, Set<string>>;
  phonesOf: Map<string, Set<string>>;
  birthYear: Map<string, number>;
  /** pco_ids that are NOT inactive — only ever a tiebreaker, never a gate. */
  active: Set<string>;
}

/** Build the matching indexes once (decrypts a person's name only when the
 *  plaintext columns are missing). Shared by import and re-match. */
function buildMatchIndexes(orgId: number): MatchIndexes {
  const db = getDb();
  const byLast = new Map<string, Array<{ id: string; first: string; last: string }>>();
  const byFullName = new Map<string, string[]>();
  const byOrg = new Map<string, string[]>();
  const birthYear = new Map<string, number>();
  for (const p of db
    .prepare(`SELECT pco_id, first_name, last_name, nickname, legal_first_name, enc_pii, birth_year FROM pco_people WHERE org_id = ?`)
    .all(orgId) as Array<{
    pco_id: string;
    first_name: string | null;
    last_name: string | null;
    nickname: string | null;
    legal_first_name: string | null;
    enc_pii: string | null;
    birth_year: number | null;
  }>) {
    let f = p.first_name;
    let l = p.last_name;
    if (f == null && l == null && p.enc_pii) {
      const pii = decryptJson<PII>(p.enc_pii);
      f = pii?.first_name ?? null;
      l = pii?.last_name ?? null;
    }
    const ln = normNamePart(l ?? "");
    // PCO keeps up to three first-name forms and a donor may use any of them:
    // first_name "John", legal_first_name "Jung", nickname "Johnny" — one person.
    const firstForms = [f, p.nickname, p.legal_first_name]
      .map((x) => normNamePart(x ?? ""))
      .filter((x) => x.length > 0);
    if (ln && firstForms.length) {
      const arr = byLast.get(ln) ?? byLast.set(ln, []).get(ln)!;
      for (const fn of new Set(firstForms)) arr.push({ id: p.pco_id, first: fn, last: ln });
    }
    for (const form of new Set(firstForms)) {
      const fk = fullNameKey(form, l);
      if (fk) (byFullName.get(fk) ?? byFullName.set(fk, []).get(fk)!).push(p.pco_id);
    }
    // Organizations are people rows too, and PCO parks a "_" in the first-name
    // field — which normalizes away to nothing, so firstForms is empty and the
    // record never lands in byLast or byFullName at all. Without this index no
    // donor could ever match a church, foundation or business.
    const ok = organizationKey(f, l);
    if (ok) (byOrg.get(ok) ?? byOrg.set(ok, []).get(ok)!).push(p.pco_id);
    if (p.birth_year != null) birthYear.set(p.pco_id, p.birth_year);
  }
  const email = new Map<string, string[]>();
  const emailsOf = new Map<string, Set<string>>();
  for (const e of db.prepare(`SELECT email_hash, person_id FROM pco_person_emails WHERE org_id = ?`).all(orgId) as Array<{ email_hash: string; person_id: string }>) {
    (email.get(e.email_hash) ?? email.set(e.email_hash, []).get(e.email_hash)!).push(e.person_id);
    (emailsOf.get(e.person_id) ?? emailsOf.set(e.person_id, new Set()).get(e.person_id)!).add(e.email_hash);
  }
  const phone = new Map<string, string[]>();
  const phonesOf = new Map<string, Set<string>>();
  for (const ph of db.prepare(`SELECT phone_hash, person_id FROM pco_person_phones WHERE org_id = ?`).all(orgId) as Array<{ phone_hash: string; person_id: string }>) {
    (phone.get(ph.phone_hash) ?? phone.set(ph.phone_hash, []).get(ph.phone_hash)!).push(ph.person_id);
    (phonesOf.get(ph.person_id) ?? phonesOf.set(ph.person_id, new Set()).get(ph.person_id)!).add(ph.phone_hash);
  }
  const active = new Set<string>(
    (db.prepare(`SELECT person_id FROM person_activity WHERE org_id = ? AND classification <> 'inactive'`).all(orgId) as Array<{ person_id: string }>).map((r) => r.person_id),
  );
  return { byLast, byFullName, byOrg, email, phone, emailsOf, phonesOf, birthYear, active };
}

/** Are these tied candidates duplicate records of ONE person? PushPay's own
 *  PCO integration creates duplicates whenever someone new gives, so this is
 *  common — and when it's true, either record is a fine target (they get
 *  merged later in the duplicate audit). We require the same name PLUS a
 *  shared email, shared phone, or same birth year; a bare name match could be
 *  two different people, which we refuse to guess at. */
function areDuplicateRecords(ids: string[], ix: MatchIndexes): boolean {
  if (ids.length < 2) return false;
  const overlaps = (a: Set<string> | undefined, b: Set<string> | undefined) => {
    if (!a || !b) return false;
    for (const v of a) if (b.has(v)) return true;
    return false;
  };
  for (let i = 1; i < ids.length; i++) {
    const a = ids[0];
    const b = ids[i];
    const shared =
      overlaps(ix.emailsOf.get(a), ix.emailsOf.get(b)) ||
      overlaps(ix.phonesOf.get(a), ix.phonesOf.get(b)) ||
      (ix.birthYear.has(a) && ix.birthYear.get(a) === ix.birthYear.get(b));
    if (!shared) return false;
  }
  return true;
}

/** Decide who a donor matches.
 *
 *  Name agreement is MANDATORY: the last name must match and the first name
 *  must be equal or a known nickname / spelling variant. Households share an
 *  inbox and a phone, so matching on contact info alone will happily point at
 *  someone's kid — a name mismatch disqualifies a candidate outright no matter
 *  how well the email and phone line up. Organizations are matched on the org
 *  name alone: their "first name" is a sort placeholder on both sides ("_" in
 *  PCO, "Z" in the PushPay export), and there's no household to confuse.
 *
 *  Among name-qualified people, whoever matches the most of (email, phone)
 *  wins. On a tie we pick either one IF they're duplicate records of the same
 *  person (PushPay creates those constantly); active status breaks a remaining
 *  tie; anything still tied is left ambiguous to be reconciled by hand. */
function decideMatch(
  first: string,
  last: string,
  eh: string | null,
  phh: string | null,
  ix: MatchIndexes,
): { personId: string | null; status: string; candidates: string[] | null } {
  const named = nameQualified(first, last, ix);
  if (!named) return { personId: null, status: "unmatched", candidates: null };
  const qualified = named.map((id) => ({ id }));

  if (qualified.length === 0) {
    // The name doesn't match anyone. Contact info alone is NOT enough — that's
    // how you end up matched to someone's kid who shares the family inbox. But
    // if the email/phone did land on somebody, surface it for a human decision
    // instead of silently dropping the donor.
    const near = new Set<string>([
      ...(eh ? ix.email.get(eh) ?? [] : []),
      ...(phh ? ix.phone.get(phh) ?? [] : []),
    ]);
    if (near.size > 0) return { personId: null, status: "ambiguous", candidates: [...near] };
    return { personId: null, status: "unmatched", candidates: null };
  }

  const em = new Set(eh ? ix.email.get(eh) ?? [] : []);
  const ph = new Set(phh ? ix.phone.get(phh) ?? [] : []);
  const votes = new Map<string, number>();
  for (const c of qualified) {
    let v = 1; // the mandatory name match
    if (em.has(c.id)) v++;
    if (ph.has(c.id)) v++;
    votes.set(c.id, v);
  }

  const max = Math.max(...votes.values());
  const top = [...votes].filter(([, c]) => c === max).map(([id]) => id);
  if (top.length === 1) return { personId: top[0], status: "matched", candidates: null };

  // Same person, duplicated in PCO → either record is fine.
  if (areDuplicateRecords(top, ix)) {
    const pick = top.find((id) => ix.active.has(id)) ?? [...top].sort()[0];
    return { personId: pick, status: "matched", candidates: top };
  }

  // Same name, and exactly one of them actually has contact info on file.
  // PushPay creates a bare PCO record whenever it can't match a donor (no
  // email/phone on the PushPay side to match on), leaving a stub with nothing
  // but a name. The populated record is the real person; the empty one is that
  // stub, and they get merged later in the duplicate audit. If SEVERAL have
  // contact details we don't guess — conflicting info goes to review.
  const hasContact = (id: string) =>
    (ix.emailsOf.get(id)?.size ?? 0) > 0 || (ix.phonesOf.get(id)?.size ?? 0) > 0;
  const populated = top.filter(hasContact);
  if (populated.length === 1) {
    return { personId: populated[0], status: "matched", candidates: top };
  }

  const act = top.filter((id) => ix.active.has(id));
  if (act.length === 1) return { personId: act[0], status: "matched", candidates: null };
  return { personId: null, status: "ambiguous", candidates: top };
}

/** The people a donor's name qualifies (decideMatch's mandatory name check):
 *  the same last name with a similar first name, the same whole name split
 *  differently, or for an organization the same org name. null when the name
 *  can't qualify anyone at all. */
function nameQualified(first: string, last: string, ix: MatchIndexes): string[] | null {
  const ln = normNamePart(last);
  const fn = normNamePart(first);
  // An organization has no first name for the mandatory check to run on, so it
  // gets its own key; a person still needs both fields.
  const org = organizationKey(first, last);
  if (!org && (!ln || !fn)) return null;

  const ids = new Set<string>();
  for (const c of ix.byLast.get(ln) ?? []) if (firstNameSimilar(fn, c.first)) ids.add(c.id);
  // Same whole name, split differently across the first/last fields.
  const fk = fullNameKey(first, last);
  for (const id of ix.byFullName.get(fk) ?? []) ids.add(id);
  // Organizations: "_" on the PCO side and "Z" on the PushPay side are sort
  // placeholders, not given names, so the org name alone decides the match.
  if (org) {
    for (const id of ix.byOrg.get(org) ?? []) ids.add(id);
  } else if (ids.size === 0 && looksLikeOrgName(fk)) {
    // No placeholder to drop — an org whose name got split across both fields.
    // Consulted only when nothing matched as a person, so a real person whose
    // name happens to read like an org ("Grace Church") can never be dragged
    // into a tie with an org record and turned ambiguous.
    for (const id of ix.byOrg.get(fk) ?? []) ids.add(id);
  }
  return [...ids];
}

// ── Hand matches survive a new upload ───────────────────────────────────────
//
// A donor someone matched by hand (match_status = 'manual') is a decision the
// automatic matcher could not make, so no later upload may quietly replace it:
// not a re-upload of All Donors, and not the name matching of a Transactions
// import. Both therefore have to recognise "the same PushPay donor" again, and
// all either export offers for that is a name, an email and a phone. donor_key
// is only the CSV row number, which shifts whenever PushPay adds or drops a
// donor above you, and the All Donors export has no PushPay donor id.

/** A donor's name as the export spells it: normName without dropping Jr, Sr,
 *  II, III, IV or V. This compares one export row with another, and a father
 *  and son who share a name and an inbox differ only by that suffix. */
function exportName(first: string, last: string): string {
  return `${first} ${last}`
    .toLowerCase()
    .replace(/[.,'`]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keyed hashes of a donor's name, email and phone, each null when the export
 *  had nothing there (or, for `name`, when a stored row can't be decrypted). */
interface DonorIdentity {
  /** normName, suffixes dropped: rows whose names differ only by a suffix are
   *  weighed together, so "John Smith" is a possible "John Smith Jr". Also
   *  what pushpay_donors.name_hash stores. */
  bucket: string | null;
  /** exportName, suffix kept: two rows can only be the same donor when this is equal. */
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** Hash a donor the one way both imports store and compare donors. */
function donorIdentity(first: string, last: string, email: string, phone: string): DonorIdentity {
  const nn = normName(first, last);
  const xn = exportName(first, last);
  const em = email.trim();
  const np = normPhone(phone);
  return {
    bucket: nn ? hmac(nn) : null,
    name: xn ? hmac(xn) : null,
    email: em ? hmac(em.toLowerCase()) : null,
    phone: np ? hmac(np) : null,
  };
}

/** THE same-donor rule, used by both imports: are these two export rows the
 *  same PushPay donor?
 *
 *  The name must be spelt the same (exportName: not a nickname, and not with
 *  a different Jr / Sr), AND the email or the phone must be equal and present
 *  on both. Households share inboxes and phones, so contact details never
 *  make a match on their own. The name alone is enough only when neither row
 *  has an email or a phone and the name is on exactly one row on each side
 *  (`nameOnceEachSide`); any second row with that name, on either side, could
 *  be the donor instead. planHandMatches adds what a single pair of rows
 *  can't show: whether another row could be the donor too. */
function sameDonor(a: DonorIdentity, b: DonorIdentity, nameOnceEachSide: boolean): boolean {
  if (!a.name || a.name !== b.name) return false;
  if (a.email && a.email === b.email) return true;
  if (a.phone && a.phone === b.phone) return true;
  return nameOnceEachSide && !a.email && !a.phone && !b.email && !b.phone;
}

/** A donor row already stored, as the identity it would be recognised by. */
interface StoredDonor extends DonorIdentity { personId: string | null; manual: boolean }

/** Every pushpay_donors row for the org. The hashes are recomputed from the
 *  decrypted row, the same way a new upload hashes its rows. A row that can't
 *  be decrypted keeps its stored name_hash and email_hash, but its name can't
 *  be compared (name_hash drops the suffix), so it can't be recognised. */
function readStoredDonors(orgId: number): StoredDonor[] {
  const rows = getDb()
    .prepare(`SELECT enc, name_hash, email_hash, person_id, match_status FROM pushpay_donors WHERE org_id = ?`)
    .all(orgId) as Array<{ enc: string; name_hash: string | null; email_hash: string | null; person_id: string | null; match_status: string }>;
  return rows.map((r) => {
    const d = decryptJson<DonorPII>(r.enc);
    const id: DonorIdentity = d
      ? donorIdentity(d.firstName ?? "", d.lastName ?? "", d.email ?? "", d.phone ?? "")
      : { bucket: r.name_hash, name: null, email: r.email_hash, phone: null };
    return { ...id, personId: r.person_id, manual: r.match_status === "manual" };
  });
}

/** Do this donor's own email and phone point at someone else with the name
 *  more strongly than at `personId`? True when a person the name qualifies
 *  (decideMatch's name check) has more of the two than `personId` has: the
 *  husband's phone on a row that shares his wife's name and inbox. */
function pointsElsewhere(first: string, last: string, id: DonorIdentity, personId: string, ix: MatchIndexes): boolean {
  if (!id.email && !id.phone) return false;
  const signals = (p: string) =>
    (id.email && ix.emailsOf.get(p)?.has(id.email) ? 1 : 0) + (id.phone && ix.phonesOf.get(p)?.has(id.phone) ? 1 : 0);
  const theirs = signals(personId);
  return (nameQualified(first, last, ix) ?? []).some((p) => p !== personId && signals(p) > theirs);
}

type HandMatchOutcome =
  /** Carry the hand match: this row is that donor and the person still exists. */
  | { kind: "keep"; personId: string }
  /** This row may be a hand-matched donor, but which one, or who they are now,
   *  needs a person to say. `personIds` are the hand-picked people who still
   *  exist, to offer as candidates. */
  | { kind: "review"; personIds: string[] };

interface HandMatchPlan {
  /** Per incoming row: keep, review, or undefined (no hand match involved:
   *  match it as usual). */
  outcome: Array<HandMatchOutcome | undefined>;
  /** The stored hand matches, by what became of them (they add up to all of
   *  them). notFound: no incoming row can be that donor: none has the name,
   *  suffix aside, or each one that has it is plainly another donor (the
   *  donor left the export, or changed their name). */
  kept: number;
  toReview: number;
  notFound: number;
}

/** Decide which incoming rows (a new All Donors upload, or a Transactions
 *  file's payers) are donors someone matched by hand among `stored`.
 *
 *  Rows are weighed by name with the suffix dropped (`bucket`), and only a
 *  bucket holding a hand match is looked at. sameDonor links an incoming row
 *  to a stored row, and linked rows form groups. An incoming row and a stored
 *  row are a PAIR when they link, have the same email and the same phone
 *  (both missing counts as the same), and neither has another such row: that
 *  row is that stored donor, whatever else is in the file.
 *   - A row paired with a hand match keeps its person when every hand match
 *     the row links to names that person and the person is still in
 *     pco_people; otherwise it goes to review.
 *   - A row paired with an automatically matched row is that donor, and is
 *     matched as usual.
 *   - Any other row that links to a hand match no pair accounts for could be
 *     that donor with a changed email or phone. It keeps the person only when
 *     the whole group is hand matches to one existing person and nothing else
 *     could be the donor: the group has no more incoming rows than stored
 *     ones, the bucket has no incoming row that links to nothing (it could be
 *     the donor with a new email and phone), and the row's own email and phone
 *     don't point at another person with the name more than at this one
 *     (pointsElsewhere: a spouse on the family inbox with her own phone).
 *     Otherwise it goes to review.
 *  A hand match no incoming row could be puts every unlinked incoming row in
 *  its bucket in review: the donor may still be there with a changed email
 *  and phone or suffix, or be one of several rows the name alone can't tell
 *  apart. With no such row, the hand match is counted as not found.
 *
 *  Review always wins over matching automatically again. A hand match exists
 *  because the automatic matcher couldn't decide, or decided wrong, for this
 *  donor; the case it gets confidently wrong is the household (two people with
 *  one name on one inbox look like one person's duplicate records to it). */
function planHandMatches(
  incoming: DonorIdentity[],
  stored: StoredDonor[],
  check: {
    personExists: (id: string) => boolean;
    /** pointsElsewhere for incoming row `i`. */
    pointsElsewhere: (i: number, personId: string) => boolean;
  },
): HandMatchPlan {
  const plan: HandMatchPlan = { outcome: new Array(incoming.length).fill(undefined), kept: 0, toReview: 0, notFound: 0 };
  const alive = (id: string | null): id is string => !!id && check.personExists(id);
  const uniq = (ids: string[]) => [...new Set(ids)];

  const byBucket = new Map<string, { inc: number[]; sto: number[] }>();
  stored.forEach((s, i) => {
    if (!s.bucket) { if (s.manual) plan.notFound++; return; }
    (byBucket.get(s.bucket) ?? byBucket.set(s.bucket, { inc: [], sto: [] }).get(s.bucket)!).sto.push(i);
  });
  incoming.forEach((d, i) => { if (d.bucket) byBucket.get(d.bucket)?.inc.push(i); });

  for (const { inc, sto } of byBucket.values()) {
    if (!sto.some((s) => stored[s].manual)) continue;
    const once = inc.length === 1 && sto.length === 1;
    const incLinks = new Map<number, number[]>(inc.map((i) => [i, sto.filter((s) => sameDonor(incoming[i], stored[s], once))]));
    const stoLinks = new Map<number, number[]>(sto.map((s) => [s, inc.filter((i) => incLinks.get(i)!.includes(s))]));
    const unlinkedInc = inc.filter((i) => incLinks.get(i)!.length === 0);
    const manualOf = (ss: number[]) => ss.filter((s) => stored[s].manual);
    const peopleOf = (ss: number[]) => uniq(ss.map((s) => stored[s].personId).filter(alive));
    const identical = (i: number, s: number) => incoming[i].email === stored[s].email && incoming[i].phone === stored[s].phone;

    const pairOf = new Map<number, number>();
    for (const i of inc) {
      const twins = incLinks.get(i)!.filter((s) => identical(i, s));
      if (twins.length === 1 && stoLinks.get(twins[0])!.filter((j) => identical(j, twins[0])).length === 1) pairOf.set(i, twins[0]);
    }
    const paired = new Set(pairOf.values());
    /** Per hand match: the incoming rows that may be its donor. */
    const mayBe = new Map<number, number[]>();

    // Walk each linked group from its first incoming row.
    const seen = new Set<number>();
    for (const start of inc) {
      if (seen.has(start) || incLinks.get(start)!.length === 0) continue;
      const gInc: number[] = [];
      const gSto = new Set<number>();
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const i = queue.shift()!;
        gInc.push(i);
        for (const s of incLinks.get(i)!) {
          if (gSto.has(s)) continue;
          gSto.add(s);
          for (const j of stoLinks.get(s)!) if (!seen.has(j)) { seen.add(j); queue.push(j); }
        }
      }
      const gManual = manualOf([...gSto]);
      if (gManual.length === 0) continue;
      const people = new Set(gManual.map((s) => stored[s].personId));
      const only = gManual.length === gSto.size && people.size === 1 ? [...people][0] : null;
      const doubt = gInc.length > gSto.size || unlinkedInc.length > 0;

      for (const i of gInc) {
        const linkedManual = manualOf(incLinks.get(i)!);
        const s = pairOf.get(i);
        let could: number[];
        if (s !== undefined) {
          if (!stored[s].manual) continue; // that automatically matched donor
          could = [s];
          const personId = stored[s].personId;
          const agree = linkedManual.every((m) => stored[m].personId === personId);
          plan.outcome[i] = agree && alive(personId)
            ? { kind: "keep", personId }
            : { kind: "review", personIds: peopleOf(linkedManual) };
        } else {
          could = linkedManual.filter((m) => !paired.has(m));
          if (could.length === 0) continue; // every hand match it links to has its own row
          plan.outcome[i] = alive(only) && !doubt && !check.pointsElsewhere(i, only)
            ? { kind: "keep", personId: only }
            : { kind: "review", personIds: peopleOf(could) };
        }
        for (const m of could) (mayBe.get(m) ?? mayBe.set(m, []).get(m)!).push(i);
      }
    }

    // Count each hand match by what became of the rows that may be its donor.
    const lost: number[] = [];
    for (const m of manualOf(sto)) {
      const rows = mayBe.get(m) ?? [];
      if (rows.length === 0) lost.push(m);
      else if (rows.every((i) => plan.outcome[i]?.kind === "keep")) plan.kept++;
      else plan.toReview++;
    }
    if (lost.length === 0) continue;
    if (unlinkedInc.length === 0) {
      plan.notFound += lost.length;
      continue;
    }
    for (const i of unlinkedInc) plan.outcome[i] = { kind: "review", personIds: peopleOf(lost) };
    plan.toReview += lost.length;
  }
  return plan;
}

/** Every pco_id in the org: a hand match carries only to a person who is still here. */
function knownPeople(orgId: number): Set<string> {
  return new Set(
    (getDb().prepare(`SELECT pco_id FROM pco_people WHERE org_id = ?`).all(orgId) as Array<{ pco_id: string }>)
      .map((r) => r.pco_id),
  );
}

/** What a new All Donors upload did with the hand matches of the one it replaced. */
export interface HandMatchCarryResult {
  /** Hand matches on the replaced upload. */
  before: number;
  /** Carried to the same donor in the new file. */
  kept: number;
  /** Their donor is in review again: which row is theirs, or who the donor is
   *  now, needs a person to say (their pick is offered as a candidate). */
  toReview: number;
  /** No row in the new file can be that donor: none has their name, or each
   *  one that has it is plainly another donor. They left the export, or
   *  changed their name. */
  notFound: number;
}

export interface DonorImportResult extends PushpayImportResult { handMatches: HandMatchCarryResult }

/** Parse the CSV, match every donor to a person, and replace the stored set,
 *  carrying over each hand match whose donor the new file plainly still has,
 *  and putting the donor back in review when it can't be sure
 *  (planHandMatches). */
export function importPushpay(orgId: number, fileName: string, csvText: string): DonorImportResult {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) {
    return { total: 0, matched: 0, ambiguous: 0, unmatched: 0, handMatches: { before: 0, kept: 0, toReview: 0, notFound: 0 } };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iF = col("first name"), iL = col("last name"), iE = col("email"), iP = col("phone number"),
    iStage = col("donor stage"), iChan = col("giving channel"), iDate = col("last gift - date"), iFund = col("last gift - fund");
  // Optional "first gift" date — the standard All Donors export doesn't include
  // it, but if the export is configured with a First Gift column we capture it
  // for the new-givers-over-time chart.
  const iFirst = ["first gift - date", "first gift date", "first gift", "first_gift_date"]
    .map((n) => col(n)).find((x) => x >= 0) ?? -1;
  if (iF < 0 || iL < 0) throw new Error("CSV is missing First Name / Last Name columns.");

  const db = getDb();
  const ix = buildMatchIndexes(orgId);

  const donors = rows.slice(1).map((r, i) => {
    const first = (r[iF] ?? "").trim(), last = (r[iL] ?? "").trim();
    const email = (r[iE] ?? "").trim(), phone = (r[iP] ?? "").trim();
    const identity = donorIdentity(first, last, email, phone);
    const dec = decideMatch(first, last, identity.email, identity.phone, ix);
    return {
      key: String(i),
      enc: encryptJson({ firstName: first, lastName: last, email, phone } as DonorPII),
      first, last, identity, nameHash: identity.bucket, emailHash: identity.email,
      stage: (r[iStage] ?? "").trim() || null, channel: (r[iChan] ?? "").trim() || null,
      date: parseDate(r[iDate] ?? ""), fund: (r[iFund] ?? "").trim() || null,
      firstDate: iFirst >= 0 ? parseDate(r[iFirst] ?? "") : null,
      personId: dec.personId, status: dec.status, candidates: dec.candidates,
    };
  });

  // The rows being replaced are read inside the transaction, so a hand match
  // made while the file was being matched is not lost between the read and the
  // DELETE. IMMEDIATE takes the write lock before that read: a transaction that
  // reads first and writes later cannot wait out another writer.
  const run = db.transaction(() => {
    const people = knownPeople(orgId);
    const plan = planHandMatches(donors.map((d) => d.identity), readStoredDonors(orgId), {
      personExists: (id) => people.has(id),
      pointsElsewhere: (i, personId) => pointsElsewhere(donors[i].first, donors[i].last, donors[i].identity, personId, ix),
    });
    plan.outcome.forEach((o, i) => {
      const d = donors[i];
      if (!o) return;
      if (o.kind === "keep") {
        // Candidates stay what matching found, so Unassign falls back to them.
        d.personId = o.personId;
        d.status = "manual";
      } else {
        // The hand-picked people first, then whoever matching would suggest.
        d.candidates = [...new Set([...o.personIds, ...(d.personId ? [d.personId] : []), ...(d.candidates ?? [])])];
        d.personId = null;
        d.status = "ambiguous";
      }
    });
    const handMatches: HandMatchCarryResult = {
      before: plan.kept + plan.toReview + plan.notFound,
      kept: plan.kept, toReview: plan.toReview, notFound: plan.notFound,
    };

    db.prepare(`DELETE FROM pushpay_donors WHERE org_id = ?`).run(orgId);
    const ins = db.prepare(`INSERT INTO pushpay_donors
      (org_id, donor_key, enc, name_hash, email_hash, donor_stage, giving_channel, last_gift_on, last_gift_fund, first_gift_on, person_id, match_status, candidate_ids)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const d of donors) ins.run(orgId, d.key, d.enc, d.nameHash, d.emailHash, d.stage, d.channel, d.date, d.fund, d.firstDate, d.personId, d.status, d.candidates ? JSON.stringify(d.candidates) : null);
    // Matched counts the carried hand matches too, as rematchDonors does, so
    // matched + ambiguous + unmatched is every donor.
    const counts: PushpayImportResult = {
      total: donors.length,
      matched: donors.filter((d) => d.status === "matched" || d.status === "manual").length,
      ambiguous: donors.filter((d) => d.status === "ambiguous").length,
      unmatched: donors.filter((d) => d.status === "unmatched").length,
    };
    db.prepare(`INSERT INTO pushpay_import (org_id, file_name, total, matched, ambiguous, unmatched, kind, imported_at)
      VALUES (?,?,?,?,?,?, 'donors', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(org_id) DO UPDATE SET file_name=excluded.file_name, total=excluded.total, matched=excluded.matched, ambiguous=excluded.ambiguous, unmatched=excluded.unmatched, kind=excluded.kind, imported_at=excluded.imported_at`)
      .run(orgId, fileName, counts.total, counts.matched, counts.ambiguous, counts.unmatched);
    // The upload history. This import replaces the whole donor set, so every
    // row it wrote is new to us (inserted = total) and the set it leaves is
    // the one an earlier All Donors upload used to hold: removing THIS upload
    // is what empties pushpay_donors (0098).
    recordUpload(orgId, "donors", fileName, { ...counts, inserted: counts.total });
    return { ...counts, handMatches };
  });
  return run.immediate();
}

// ── Upload history ──────────────────────────────────────────────────────────
//
// pushpay_uploads holds one row per upload of either export, so the /pushpay
// page can list what has been loaded and take one back out. Schema, and the
// removal semantics, in db/migrations/0098_pushpay_uploads.sql.

export type PushpayUploadKind = "donors" | "transactions";

interface UploadCounts {
  total: number;
  inserted: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  byYourId?: number;
  byDonorManual?: number;
  byDonorMatch?: number;
  firstGiftOn?: string | null;
  lastGiftOn?: string | null;
}

/** Record an upload and return its id. Always called inside the import's own
 *  transaction. A transactions import calls it FIRST, because every gift it
 *  writes is stamped with this id, and then updates `inserted` once the rows
 *  are in and the new ones can be counted; a donors import, which stamps
 *  nothing, calls it last. */
function recordUpload(orgId: number, kind: PushpayUploadKind, fileName: string, c: UploadCounts): number {
  const r = getDb().prepare(
    `INSERT INTO pushpay_uploads
       (org_id, kind, file_name, total, inserted, matched, ambiguous, unmatched,
        by_your_id, by_donor_manual, by_donor_match, first_gift_on, last_gift_on)
     VALUES (@org, @kind, @file, @total, @inserted, @matched, @ambiguous, @unmatched,
             @yourId, @donorManual, @donorMatch, @firstOn, @lastOn)`,
  ).run({
    org: orgId, kind, file: fileName,
    total: c.total, inserted: c.inserted, matched: c.matched, ambiguous: c.ambiguous, unmatched: c.unmatched,
    yourId: c.byYourId ?? 0, donorManual: c.byDonorManual ?? 0, donorMatch: c.byDonorMatch ?? 0,
    firstOn: c.firstGiftOn ?? null, lastOn: c.lastGiftOn ?? null,
  });
  return Number(r.lastInsertRowid);
}

/** The org's uploads, newest first, each with what removing it would do. */
export interface PushpayUploadRow {
  id: number;
  kind: PushpayUploadKind;
  fileName: string | null;
  importedAt: string;
  total: number;
  inserted: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  byYourId: number;
  byDonorManual: number;
  byDonorMatch: number;
  firstGiftOn: string | null;
  lastGiftOn: string | null;
  /** The synthetic row standing for the gifts that were here before this
   *  history began (written by 0098). */
  isBackfilled: boolean;
  /** Gifts of this file still in the database (pushpay_transaction_uploads). */
  giftsHeld: number;
  /** Of those, the ones no OTHER upload supplies: exactly what Remove deletes. */
  giftsOwned: number;
  /** Of those, the ones another upload supplies too, older or newer. They stay,
   *  because that file still says the gift happened. */
  giftsShared: number;
  /** Of the ones that stay, how many still hold the person, source and fund
   *  THIS file wrote (last_upload_id = it). Removing the upload cannot put the
   *  earlier values back — we keep no per-upload versions of a row. */
  giftsKeepingValues: number;
  /** Donors it would empty (the whole set, since All Donors replaces it). */
  donorsHeld: number;
  /** A donors upload whose set a later All Donors upload has already replaced.
   *  Removing it takes nothing out of pushpay_donors — only this record. */
  superseded: boolean;
}

export function listPushpayUploads(orgId: number): PushpayUploadRow[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, kind, file_name, imported_at, total, inserted, matched, ambiguous, unmatched,
            by_your_id, by_donor_manual, by_donor_match, first_gift_on, last_gift_on, is_backfilled
       FROM pushpay_uploads WHERE org_id = ? ORDER BY imported_at DESC, id DESC`,
  ).all(orgId) as Array<{
    id: number; kind: string; file_name: string | null; imported_at: string;
    total: number; inserted: number; matched: number; ambiguous: number; unmatched: number;
    by_your_id: number; by_donor_manual: number; by_donor_match: number;
    first_gift_on: string | null; last_gift_on: string | null; is_backfilled: number;
  }>;
  // One grouped pass over the org's supply rows (16.5k today), rather than
  // three counts per upload. `n` is how many uploads supply each gift: 1 means
  // this upload is the only thing keeping it, so Remove deletes it.
  const held = new Map<number, { held: number; owned: number; keeps: number }>();
  for (const r of db.prepare(
    `SELECT l.upload_id AS id,
            COUNT(*) AS held,
            SUM(CASE WHEN c.n = 1 THEN 1 ELSE 0 END) AS owned,
            SUM(CASE WHEN c.n > 1 AND t.last_upload_id = l.upload_id THEN 1 ELSE 0 END) AS keeps
       FROM pushpay_transaction_uploads l
       JOIN pushpay_transactions t
         ON t.org_id = l.org_id AND t.transaction_id = l.transaction_id
       JOIN (SELECT org_id, transaction_id, COUNT(*) AS n
               FROM pushpay_transaction_uploads WHERE org_id = ?
              GROUP BY org_id, transaction_id) c
         ON c.org_id = l.org_id AND c.transaction_id = l.transaction_id
      WHERE l.org_id = ?
      GROUP BY l.upload_id`,
  ).all(orgId, orgId) as Array<{ id: number; held: number; owned: number; keeps: number }>) {
    held.set(r.id, { held: r.held, owned: r.owned, keeps: r.keeps });
  }
  const donors = (db.prepare(`SELECT COUNT(*) AS n FROM pushpay_donors WHERE org_id = ?`).get(orgId) as { n: number }).n;
  const newestDonorUpload = rows.find((r) => r.kind === "donors")?.id ?? null;
  return rows.map((r) => {
    const g = held.get(r.id) ?? { held: 0, owned: 0, keeps: 0 };
    const superseded = r.kind === "donors" && r.id !== newestDonorUpload;
    const isDonors = r.kind === "donors";
    return {
      id: r.id, kind: isDonors ? "donors" : "transactions",
      fileName: r.file_name, importedAt: r.imported_at,
      total: r.total, inserted: r.inserted, matched: r.matched, ambiguous: r.ambiguous, unmatched: r.unmatched,
      byYourId: r.by_your_id, byDonorManual: r.by_donor_manual, byDonorMatch: r.by_donor_match,
      firstGiftOn: r.first_gift_on, lastGiftOn: r.last_gift_on, isBackfilled: r.is_backfilled === 1,
      giftsHeld: isDonors ? 0 : g.held,
      giftsOwned: isDonors ? 0 : g.owned,
      giftsShared: isDonors ? 0 : g.held - g.owned,
      giftsKeepingValues: isDonors ? 0 : g.keeps,
      donorsHeld: isDonors && !superseded ? donors : 0,
      superseded,
    };
  });
}

/** Rewrite pushpay_import — the one-row-per-org "last import" summary two
 *  pages still read (getPushpayImport) — from the newest upload left, or drop
 *  it when none are. Called after a removal, so the page can never name a file
 *  that has just been taken out.
 *
 *  A donors upload is only eligible while its rows are actually here. Remove
 *  the newest All Donors upload and pushpay_donors is emptied; the donors
 *  upload before it is then the newest row in the table, but its donors were
 *  replaced long ago and have now been deleted, so summarising it would put
 *  "3 donors — 2 matched" on a page whose donor list is empty. */
function rewritePushpayImportSummary(orgId: number): void {
  const db = getDb();
  type Row = { kind: string; file_name: string | null; total: number; matched: number; ambiguous: number; unmatched: number; imported_at: string };
  const pick = (onlyTransactions: boolean) =>
    db.prepare(
      `SELECT kind, file_name, total, matched, ambiguous, unmatched, imported_at
         FROM pushpay_uploads WHERE org_id = ?${onlyTransactions ? ` AND kind = 'transactions'` : ""}
        ORDER BY imported_at DESC, id DESC LIMIT 1`,
    ).get(orgId) as Row | undefined;
  let u = pick(false);
  if (u?.kind === "donors") {
    const donors = (db.prepare(`SELECT COUNT(*) AS n FROM pushpay_donors WHERE org_id = ?`).get(orgId) as { n: number }).n;
    if (donors === 0) u = pick(true);
  }
  if (!u) {
    db.prepare(`DELETE FROM pushpay_import WHERE org_id = ?`).run(orgId);
    return;
  }
  db.prepare(
    `INSERT INTO pushpay_import (org_id, file_name, total, matched, ambiguous, unmatched, kind, imported_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(org_id) DO UPDATE SET file_name=excluded.file_name, total=excluded.total,
       matched=excluded.matched, ambiguous=excluded.ambiguous, unmatched=excluded.unmatched,
       kind=excluded.kind, imported_at=excluded.imported_at`,
  ).run(orgId, u.file_name, u.total, u.matched, u.ambiguous, u.unmatched, u.kind, u.imported_at);
}

export interface UploadRemovalResult {
  kind: PushpayUploadKind;
  fileName: string | null;
  /** Gifts deleted: the ones this upload supplied that no other upload did. */
  giftsRemoved: number;
  /** Gifts it supplied that another upload supplies too, so they stayed. */
  giftsKept: number;
  /** Of those, the ones still holding the person, source and fund this upload
   *  wrote. Nothing can put the earlier values back. */
  giftsKeepingValues: number;
  donorsRemoved: number;
  /** Its donors had already been replaced by a later All Donors upload, so
   *  only the record went. */
  supersededDonors: boolean;
}

/** Remove one upload: its rows, then its record, then the rollup.
 *
 *  Transactions: delete the gifts this upload supplied that NO other upload
 *  still supplies (pushpay_transaction_uploads). A gift another file also
 *  carried stays, whether that file is older or newer — it is still here and
 *  still says the gift happened. Once every upload that supplied a gift has
 *  been removed the gift goes, because nothing left says it happened.
 *
 *  The two provenance columns take no part in that decision, which is the
 *  whole reason the supply table exists: export windows overlap, so with three
 *  files C1 ⊂ C2 ⊂ C3 all holding gift x, two columns can only remember two of
 *  the three, and removing C1 then C3 used to delete x while C2 was still in
 *  the list. What the columns DO say is where a surviving gift's values came
 *  from, so removing an upload blanks the ones that named it: the file that
 *  wrote them is gone, and no other file is credited with its work. A gift that
 *  stays keeps the person, source and fund it holds now — we keep no
 *  per-upload versions of a row, so there is nothing to put back, and the UI
 *  counts those gifts and says so before it asks.
 *
 *  Donors: the All Donors import replaces the whole set, so removing the
 *  newest one empties pushpay_donors. An older one's donors are already gone
 *  (a later upload replaced them): removing it takes out the record alone.
 *
 *  All of it in ONE transaction, IMMEDIATE because it reads the upload row
 *  before it writes, and ending with the rollup rebuild — so the derived
 *  tables can never be left describing gifts that are no longer here. */
export function removePushpayUpload(orgId: number, uploadId: number): UploadRemovalResult {
  const db = getDb();
  const run = db.transaction(() => {
    const u = db.prepare(`SELECT id, kind, file_name FROM pushpay_uploads WHERE org_id = ? AND id = ?`)
      .get(orgId, uploadId) as { id: number; kind: string; file_name: string | null } | undefined;
    if (!u) throw new Error("That upload is no longer in the history — someone may have removed it already.");
    const out: UploadRemovalResult = {
      kind: u.kind === "donors" ? "donors" : "transactions",
      fileName: u.file_name, giftsRemoved: 0, giftsKept: 0, giftsKeepingValues: 0,
      donorsRemoved: 0, supersededDonors: false,
    };
    if (out.kind === "transactions") {
      // Counted before anything is deleted: gifts of this file that another
      // upload also supplies (so they stay), and how many of those still hold
      // the values THIS file wrote.
      const kept = db.prepare(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN t.last_upload_id = ? THEN 1 ELSE 0 END) AS mine
           FROM pushpay_transaction_uploads l
           JOIN pushpay_transactions t
             ON t.org_id = l.org_id AND t.transaction_id = l.transaction_id
          WHERE l.org_id = ? AND l.upload_id = ?
            AND EXISTS (SELECT 1 FROM pushpay_transaction_uploads o
                         WHERE o.org_id = l.org_id AND o.transaction_id = l.transaction_id
                           AND o.upload_id <> l.upload_id)`,
      ).get(u.id, orgId, u.id) as { n: number; mine: number | null };
      out.giftsKept = kept.n;
      out.giftsKeepingValues = kept.mine ?? 0;
      // Gifts nothing else supplies. Restricted to this upload's own gifts, so
      // a gift that belongs to no upload at all (written by the old code during
      // a deploy) is never swept up by someone else's removal.
      out.giftsRemoved = db.prepare(
        `DELETE FROM pushpay_transactions
          WHERE org_id = ? AND transaction_id IN (
            SELECT l.transaction_id FROM pushpay_transaction_uploads l
             WHERE l.org_id = ? AND l.upload_id = ?
               AND NOT EXISTS (SELECT 1 FROM pushpay_transaction_uploads o
                                WHERE o.org_id = l.org_id AND o.transaction_id = l.transaction_id
                                  AND o.upload_id <> l.upload_id))`,
      ).run(orgId, orgId, u.id).changes;
      // The supply rows of the gifts just deleted went with them (this upload
      // was their only one); this clears the ones on the gifts that stayed.
      db.prepare(`DELETE FROM pushpay_transaction_uploads WHERE org_id = ? AND upload_id = ?`).run(orgId, u.id);
      // Value provenance: blank what named this upload, rather than crediting
      // another file with values it did not write.
      db.prepare(`UPDATE pushpay_transactions SET first_upload_id = NULL WHERE org_id = ? AND first_upload_id = ?`).run(orgId, u.id);
      db.prepare(`UPDATE pushpay_transactions SET last_upload_id = NULL WHERE org_id = ? AND last_upload_id = ?`).run(orgId, u.id);
    } else {
      const newest = db.prepare(
        `SELECT id FROM pushpay_uploads WHERE org_id = ? AND kind = 'donors' ORDER BY imported_at DESC, id DESC LIMIT 1`,
      ).get(orgId) as { id: number } | undefined;
      out.supersededDonors = newest?.id !== u.id;
      if (!out.supersededDonors) {
        out.donorsRemoved = db.prepare(`DELETE FROM pushpay_donors WHERE org_id = ?`).run(orgId).changes;
      }
    }
    db.prepare(`DELETE FROM pushpay_uploads WHERE org_id = ? AND id = ?`).run(orgId, u.id);
    refreshPushpayGiving(orgId);
    rewritePushpayImportSummary(orgId);
    return out;
  });
  return run.immediate();
}

// ── Per-giver rollup ────────────────────────────────────────────────────────
//
// pushpay_payer_summary / pushpay_giving_snapshot, one row per payer and one
// per org, rebuilt whole from pushpay_transactions. Schema and reasoning in
// db/migrations/0098_pushpay_uploads.sql, whose first build is this same SQL
// over every org at once — keep the two in step, as 0091 and
// refreshCcEngagement do for the email rollups.

const PAYER_SUMMARY_SQL = `
INSERT INTO pushpay_payer_summary
  (org_id, payer_id, person_id, is_linked, first_gift_on, last_gift_on,
   gifts, recurring_gifts, other_gifts, funds)
WITH g AS (
  SELECT org_id, COALESCE(payer_id, 'tx:' || transaction_id) AS pk,
         transaction_id, person_id, received_on, source, fund_name, imported_at
    FROM pushpay_transactions WHERE org_id = @org
),
link AS (
  SELECT pk, person_id FROM (
    SELECT pk, person_id,
           ROW_NUMBER() OVER (PARTITION BY pk
                              ORDER BY (person_id IS NULL), imported_at DESC, transaction_id DESC) AS rn
      FROM g)
   WHERE rn = 1
),
fund AS (
  SELECT pk, json_group_array(fund_name) AS funds
    FROM (SELECT DISTINCT pk, fund_name FROM g
           WHERE fund_name IS NOT NULL AND fund_name <> ''
           ORDER BY pk, fund_name)
   GROUP BY pk
)
SELECT g.org_id, g.pk, l.person_id,
       CASE WHEN l.person_id IS NULL THEN 0 ELSE 1 END,
       MIN(g.received_on), MAX(g.received_on), COUNT(*),
       SUM(CASE WHEN g.source = 'Recurring' THEN 1 ELSE 0 END),
       SUM(CASE WHEN g.source = 'Recurring' THEN 0 ELSE 1 END),
       COALESCE(f.funds, '[]')
  FROM g
  JOIN link l ON l.pk = g.pk
  LEFT JOIN fund f ON f.pk = g.pk
 GROUP BY g.pk`;

const GIVING_SNAPSHOT_SQL = `
INSERT INTO pushpay_giving_snapshot
  (org_id, payers, linked_payers, gifts, first_gift_on, last_gift_on, source_rows, source_written_at)
SELECT @org,
       COUNT(*), COALESCE(SUM(s.is_linked), 0), COALESCE(SUM(s.gifts), 0),
       MIN(s.first_gift_on), MAX(s.last_gift_on),
       (SELECT COUNT(*) FROM pushpay_transactions t WHERE t.org_id = @org),
       (SELECT MAX(t.imported_at) FROM pushpay_transactions t WHERE t.org_id = @org)
  FROM pushpay_payer_summary s WHERE s.org_id = @org`;

/** Rebuild the org's giving rollups from pushpay_transactions, from scratch,
 *  in one transaction: readers see the old rollup or the new one, never half
 *  of each.
 *
 *  Called at the END of every transactions import and every dataset removal,
 *  from INSIDE their transaction — which is stronger than the "run it on every
 *  attempt, success or failure" rule the email rollups follow: the rebuild
 *  commits with the gifts or not at all, so a killed import (this process is
 *  capped at 150 MB and gets killed) can never leave the rollup describing
 *  gifts that are not there. isPushpayGivingStale is the backstop for the
 *  seconds of a deploy when the old code still serves, and for hand edits. */
export function refreshPushpayGiving(orgId: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM pushpay_payer_summary WHERE org_id = ?`).run(orgId);
    db.prepare(`DELETE FROM pushpay_giving_snapshot WHERE org_id = ?`).run(orgId);
    db.prepare(PAYER_SUMMARY_SQL).run({ org: orgId });
    // One row even with no gifts, so "built, and empty" is distinguishable
    // from "never built" — the GROUP-less aggregate always returns one row.
    db.prepare(GIVING_SNAPSHOT_SQL).run({ org: orgId });
  })();
}

/** True when pushpay_transactions has moved since the rollup was built: a
 *  different row count, or a row written later than the watermark. Both come
 *  from one query covered by pushpay_tx_imported, so the check never reads the
 *  table itself. The cron calls it every 15 minutes. */
export function isPushpayGivingStale(orgId: number): boolean {
  const db = getDb();
  const live = db.prepare(
    `SELECT COUNT(*) AS n, MAX(imported_at) AS w FROM pushpay_transactions WHERE org_id = ?`,
  ).get(orgId) as { n: number; w: string | null };
  const built = db.prepare(
    `SELECT source_rows AS n, source_written_at AS w FROM pushpay_giving_snapshot WHERE org_id = ?`,
  ).get(orgId) as { n: number; w: string | null } | undefined;
  if (!built) return live.n > 0;
  return built.n !== live.n || built.w !== live.w;
}

export interface PushpayGivingSummary {
  payers: number;
  linkedPayers: number;
  gifts: number;
  firstGiftOn: string | null;
  lastGiftOn: string | null;
  builtAt: string;
}

/** What the database holds now, from the rollup's snapshot row. Null before
 *  the rollup has ever been built for the org. */
export function getPushpayGivingSummary(orgId: number): PushpayGivingSummary | null {
  const r = getDb().prepare(
    `SELECT payers, linked_payers, gifts, first_gift_on, last_gift_on, built_at
       FROM pushpay_giving_snapshot WHERE org_id = ?`,
  ).get(orgId) as
    | { payers: number; linked_payers: number; gifts: number; first_gift_on: string | null; last_gift_on: string | null; built_at: string }
    | undefined;
  return r
    ? { payers: r.payers, linkedPayers: r.linked_payers, gifts: r.gifts, firstGiftOn: r.first_gift_on, lastGiftOn: r.last_gift_on, builtAt: r.built_at }
    : null;
}

export interface TransactionImportResult {
  total: number;
  inserted: number;
  byYourId: number;
  /** A payer with no usable Your ID who is a donor matched by hand on the All
   *  Donors list (match_source 'donor_manual'). */
  byDonorManual: number;
  byDonorMatch: number;
  unmatched: number;
  firstDate: string | null;
  lastDate: string | null;
}

/** Does this CSV look like the Transactions export rather than All Donors? */
export function isTransactionsExport(csvText: string): boolean {
  const first = csvText.slice(0, 4096).split(/\r?\n/)[0]?.toLowerCase() ?? "";
  return first.includes("transaction id") && first.includes("received on");
}

/** Import the PushPay Transactions export — one row per gift.
 *
 *  Person resolution, in order:
 *    1. "Your ID" is the church's own id on the payer record, and it IS the PCO
 *       person id: 1,113 of 1,140 distinct values in the September 2026 export
 *       resolve against pco_people. That is a direct link and beats name
 *       matching, so it is tried first.
 *    2. Otherwise, a donor someone matched by hand on the All Donors list, when
 *       the payer is that same donor by the rule a re-upload uses to carry
 *       hand matches over (sameDonor / planHandMatches: the same name, Jr or
 *       Sr included, plus the same email or phone, or the name alone when
 *       neither has either and it is on one payer and one donor only), every
 *       hand match they could be names the same person, that person is still
 *       in pco_people, and nothing casts doubt on it: a payer whose email or
 *       phone differ from the donor's needs no other payer with that name
 *       who could be the donor instead, and no other person with that name
 *       holding more of that email and phone. match_source 'donor_manual'.
 *    3. Otherwise the same name/email/phone matching the donor import uses
 *       (decideMatch): 'donor_match', or 'unmatched'.
 *
 *  Upsert rather than replace: the export is a window (the sample covers
 *  January to September 2026), so re-importing a later window must add to the
 *  history rather than delete everything outside it. Transaction ID is stable,
 *  so a gift seen twice updates in place. */
export function importPushpayTransactions(
  orgId: number,
  fileName: string,
  csvText: string,
): TransactionImportResult {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) {
    return { total: 0, inserted: 0, byYourId: 0, byDonorManual: 0, byDonorMatch: 0, unmatched: 0, firstDate: null, lastDate: null };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const iTx = col("transaction id"), iDate = col("received on"), iStatus = col("status"),
    iSource = col("source"), iPayer = col("payer id"), iYour = col("your id"),
    iFundName = col("fund name"), iFundCode = col("fund code"),
    iF = col("first name"), iL = col("last name"), iE = col("email"), iP = col("mobile number", "phone number");
  if (iTx < 0 || iDate < 0) throw new Error("CSV is missing Transaction ID / Received On columns.");

  const db = getDb();
  const ix = buildMatchIndexes(orgId);
  const knownPerson = knownPeople(orgId);

  const out: TransactionImportResult = {
    total: 0, inserted: 0, byYourId: 0, byDonorManual: 0, byDonorMatch: 0, unmatched: 0, firstDate: null, lastDate: null,
  };
  // Payer -> person decided once per payer, not once per gift: a donor with 40
  // gifts should cost one matching decision, and every one of their rows must
  // land on the same person. A payer is known by the details on their first gift.
  const payers = new Map<string, { yourId: string; first: string; last: string; identity: DonorIdentity }>();
  const gifts: Array<{
    txId: string; date: string; status: string | null; source: string | null;
    payer: string | null; payerKey: string; fundName: string | null; fundCode: string | null;
  }> = [];

  for (const r of rows.slice(1)) {
    const txId = (r[iTx] ?? "").trim();
    const date = parseDate(r[iDate] ?? "");
    if (!txId || !date) continue;
    out.total++;
    if (!out.firstDate || date < out.firstDate) out.firstDate = date;
    if (!out.lastDate || date > out.lastDate) out.lastDate = date;

    const payer = (r[iPayer] ?? "").trim() || null;
    const payerKey = payer ?? `tx:${txId}`;
    if (!payers.has(payerKey)) {
      const first = iF >= 0 ? (r[iF] ?? "").trim() : "";
      const last = iL >= 0 ? (r[iL] ?? "").trim() : "";
      const email = iE >= 0 ? (r[iE] ?? "").trim() : "";
      const phone = iP >= 0 ? (r[iP] ?? "").trim() : "";
      payers.set(payerKey, {
        yourId: iYour >= 0 ? (r[iYour] ?? "").trim() : "",
        first, last, identity: donorIdentity(first, last, email, phone),
      });
    }
    gifts.push({
      txId, date,
      status: (r[iStatus] ?? "").trim() || null,
      source: (r[iSource] ?? "").trim() || null,
      payer, payerKey,
      fundName: iFundName >= 0 ? (r[iFundName] ?? "").trim() || null : null,
      fundCode: iFundCode >= 0 ? (r[iFundCode] ?? "").trim() || null : null,
    });
  }

  // Hand matches on the All Donors list, recognised by the rule a re-upload
  // uses. Every payer takes part, including those Your ID resolves: such a
  // payer may still be the hand-matched donor, and so keep another payer with
  // that name from taking the match.
  const payerKeys = [...payers.keys()];
  const hand = planHandMatches(
    payerKeys.map((k) => payers.get(k)!.identity),
    readStoredDonors(orgId),
    {
      personExists: (id) => knownPerson.has(id),
      pointsElsewhere: (i, personId) => {
        const p = payers.get(payerKeys[i])!;
        return pointsElsewhere(p.first, p.last, p.identity, personId, ix);
      },
    },
  );
  const decided = new Map<string, { personId: string | null; how: string }>();
  payerKeys.forEach((k, i) => {
    const p = payers.get(k)!;
    const handMatch = hand.outcome[i];
    if (p.yourId && knownPerson.has(p.yourId)) {
      decided.set(k, { personId: p.yourId, how: "your_id" });
    } else if (handMatch?.kind === "keep") {
      decided.set(k, { personId: handMatch.personId, how: "donor_manual" });
    } else {
      const dec = p.first || p.last
        ? decideMatch(p.first, p.last, p.identity.email, p.identity.phone, ix)
        : { personId: null, status: "unmatched" as const, candidates: null };
      decided.set(k, { personId: dec.personId, how: dec.personId ? "donor_match" : "unmatched" });
    }
  });

  const parsed = gifts.map((g) => {
    const d = decided.get(g.payerKey)!;
    if (d.how === "your_id") out.byYourId++;
    else if (d.how === "donor_manual") out.byDonorManual++;
    else if (d.how === "donor_match") out.byDonorMatch++;
    else out.unmatched++;
    return { ...g, personId: d.personId, how: d.how };
  });

  // One transaction: the upload's record, its gifts, and the rollup rebuilt
  // from them all commit together, or none of them do. IMMEDIATE because it
  // reads (the row count, to tell new gifts from re-supplied ones) before it
  // writes, and a transaction that reads first cannot wait out another writer.
  const run = db.transaction(() => {
    const countRows = db.prepare(`SELECT COUNT(*) AS n FROM pushpay_transactions WHERE org_id = ?`);
    const before = (countRows.get(orgId) as { n: number }).n;
    const matched = out.byYourId + out.byDonorManual + out.byDonorMatch;
    const uploadId = recordUpload(orgId, "transactions", fileName, {
      total: out.total, inserted: 0, matched, ambiguous: 0, unmatched: out.unmatched,
      byYourId: out.byYourId, byDonorManual: out.byDonorManual, byDonorMatch: out.byDonorMatch,
      firstGiftOn: out.firstDate, lastGiftOn: out.lastDate,
    });
    // first_upload_id is set only on insert, so it keeps naming the upload
    // that introduced the gift; last_upload_id moves to whoever wrote the
    // values it holds now. They are value provenance only — what a removal
    // may delete is decided by pushpay_transaction_uploads below (0098).
    const ins = db.prepare(`INSERT INTO pushpay_transactions
      (org_id, transaction_id, received_on, status, source, payer_id, person_id, match_source, fund_name, fund_code, first_upload_id, last_upload_id, imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(org_id, transaction_id) DO UPDATE SET
        received_on = excluded.received_on, status = excluded.status, source = excluded.source,
        payer_id = excluded.payer_id, person_id = excluded.person_id,
        match_source = excluded.match_source, fund_name = excluded.fund_name,
        fund_code = excluded.fund_code, last_upload_id = excluded.last_upload_id,
        imported_at = excluded.imported_at`);
    // One supply row per gift THIS file listed, re-supplies included: that is
    // what says the gift may not be deleted while this file is here, and what
    // lets three overlapping windows all claim the same gift. OR IGNORE
    // because one file can list a transaction id twice, and because a file
    // imported again writes the same pair.
    const link = db.prepare(
      `INSERT OR IGNORE INTO pushpay_transaction_uploads (org_id, transaction_id, upload_id) VALUES (?,?,?)`,
    );
    for (const p of parsed) {
      ins.run(orgId, p.txId, p.date, p.status, p.source, p.payer, p.personId, p.how, p.fundName, p.fundCode, uploadId, uploadId);
      link.run(orgId, p.txId, uploadId);
    }
    // How many were NEW. An INSERT ... ON CONFLICT DO UPDATE reports one
    // change whether it inserted or updated, so the statement's own result
    // cannot tell them apart; the row count before and after can.
    out.inserted = (countRows.get(orgId) as { n: number }).n - before;
    db.prepare(`UPDATE pushpay_uploads SET inserted = ? WHERE id = ?`).run(out.inserted, uploadId);
    db.prepare(`INSERT INTO pushpay_import (org_id, file_name, total, matched, ambiguous, unmatched, kind, imported_at)
      VALUES (?,?,?,?,?,?, 'transactions', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(org_id) DO UPDATE SET file_name=excluded.file_name, total=excluded.total,
        matched=excluded.matched, ambiguous=excluded.ambiguous, unmatched=excluded.unmatched,
        kind=excluded.kind, imported_at=excluded.imported_at`)
      .run(orgId, fileName, out.total, matched, 0, out.unmatched);
    // Last, and inside the transaction, so the rollup always describes the
    // gifts that just landed — not on a success-only branch that a killed
    // process could skip.
    refreshPushpayGiving(orgId);
  });
  run.immediate();
  return out;
}

export interface RematchResult extends PushpayImportResult { changed: number }

/** Re-run matching on the already-imported donors (no re-upload) with the
 *  current rules + latest PCO people. Human assignments (match_status =
 *  'manual') are left untouched. Returns the new counts + how many rows moved. */
export function rematchDonors(orgId: number): RematchResult {
  const db = getDb();
  const ix = buildMatchIndexes(orgId);
  const rows = db.prepare(`SELECT donor_key, enc, match_status, person_id FROM pushpay_donors WHERE org_id = ?`).all(orgId) as Array<{ donor_key: string; enc: string; match_status: string; person_id: string | null }>;
  const upd = db.prepare(`UPDATE pushpay_donors SET person_id = ?, match_status = ?, candidate_ids = ? WHERE org_id = ? AND donor_key = ?`);
  let changed = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      if (r.match_status === "manual") continue; // never clobber a human assignment
      const d = decryptJson<DonorPII>(r.enc);
      const eh = d?.email ? hmac(d.email.trim().toLowerCase()) : null;
      const np = normPhone(d?.phone ?? null);
      const phh = np ? hmac(np) : null;
      const dec = decideMatch(d?.firstName ?? "", d?.lastName ?? "", eh, phh, ix);
      if (dec.status !== r.match_status || dec.personId !== r.person_id) changed++;
      upd.run(dec.personId, dec.status, dec.candidates ? JSON.stringify(dec.candidates) : null, orgId, r.donor_key);
    }
  });
  run();
  const c = countDonorsByStatus(orgId);
  const matched = c.matched + c.manual;
  const total = matched + c.ambiguous + c.unmatched;
  db.prepare(`UPDATE pushpay_import SET matched = ?, ambiguous = ?, unmatched = ? WHERE org_id = ?`)
    .run(matched, c.ambiguous, c.unmatched, orgId);
  return { total, matched, ambiguous: c.ambiguous, unmatched: c.unmatched, changed };
}

export interface PushpayImportMeta {
  fileName: string | null;
  total: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  importedAt: string | null;
  /** Which export this row describes: 'transactions' (its counts are gifts) or
   *  'donors'. NULL only on a row written before 0087 added the column. */
  kind: string | null;
}

/** The last upload of either kind, the one-row-per-org summary pushpay_import
 *  has always held. Both importers still write it, and a removal rewrites it
 *  from the newest upload left (rewritePushpayImportSummary), so it can never
 *  name a file that is no longer in the Datasets list. The list itself comes
 *  from pushpay_uploads (listPushpayUploads); this is the summary line. */
export function getPushpayImport(orgId: number): PushpayImportMeta | null {
  const r = getDb().prepare(`SELECT file_name, total, matched, ambiguous, unmatched, imported_at, kind FROM pushpay_import WHERE org_id = ?`).get(orgId) as
    | { file_name: string | null; total: number; matched: number; ambiguous: number; unmatched: number; imported_at: string; kind: string | null } | undefined;
  return r ? { fileName: r.file_name, total: r.total, matched: r.matched, ambiguous: r.ambiguous, unmatched: r.unmatched, importedAt: r.imported_at, kind: r.kind } : null;
}

export interface DonorRow {
  donorKey: string; fullName: string; email: string; phone: string;
  stage: string | null; channel: string | null; lastGiftDate: string | null; fund: string | null;
  status: string; personId: string | null; assignedName: string | null;
  candidates: Array<{ pcoId: string; name: string; sharesEmail: boolean; sharesPhone: boolean; active: boolean }>;
}

/** Per-candidate context for the reconcile UI — since PCO email/phone are only
 *  stored as one-way hashes, we can't show the raw values, but we CAN show
 *  whether a candidate shares the donor's email/phone (an exact-hash match) and
 *  whether they're the active record (vs. an old inactive dupe). */
function candidateContext(orgId: number, ids: string[]): { emails: Map<string, Set<string>>; phones: Map<string, Set<string>>; active: Set<string> } {
  const emails = new Map<string, Set<string>>();
  const phones = new Map<string, Set<string>>();
  const active = new Set<string>();
  if (!ids.length) return { emails, phones, active };
  const ph = ids.map(() => "?").join(",");
  const db = getDb();
  for (const r of db.prepare(`SELECT person_id, email_hash FROM pco_person_emails WHERE org_id = ? AND person_id IN (${ph})`).all(orgId, ...ids) as Array<{ person_id: string; email_hash: string }>) {
    (emails.get(r.person_id) ?? emails.set(r.person_id, new Set()).get(r.person_id)!).add(r.email_hash);
  }
  for (const r of db.prepare(`SELECT person_id, phone_hash FROM pco_person_phones WHERE org_id = ? AND person_id IN (${ph})`).all(orgId, ...ids) as Array<{ person_id: string; phone_hash: string }>) {
    (phones.get(r.person_id) ?? phones.set(r.person_id, new Set()).get(r.person_id)!).add(r.phone_hash);
  }
  for (const r of db.prepare(`SELECT person_id FROM person_activity WHERE org_id = ? AND classification <> 'inactive' AND person_id IN (${ph})`).all(orgId, ...ids) as Array<{ person_id: string }>) {
    active.add(r.person_id);
  }
  return { emails, phones, active };
}

/** "First Last" from the plaintext columns, falling back to enc_pii, and to the
 *  PCO id when the record genuinely has no name on file. */
function personLabel(first: string | null, last: string | null, enc: string | null, pcoId: string): string {
  let f = first;
  let l = last;
  if (f == null && l == null && enc) {
    const pii = decryptJson<PII>(enc);
    f = pii?.first_name ?? null;
    l = pii?.last_name ?? null;
  }
  return [f, l].filter(Boolean).join(" ").trim() || `#${pcoId}`;
}

const donorName = (enc: string): { fullName: string; email: string; phone: string } => {
  const p = decryptJson<DonorPII>(enc);
  return { fullName: [p?.firstName, p?.lastName].filter(Boolean).join(" ") || "—", email: p?.email ?? "", phone: p?.phone ?? "" };
};

/** Person names, for resolving ambiguous candidates. Names live in plaintext
 *  columns; enc_pii is only a fallback for rows predating that move — reading
 *  enc_pii alone renders anyone already on the plaintext columns as a bare
 *  "#12345678" in the reconcile list. */
function personNames(orgId: number, ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  for (const r of getDb().prepare(`SELECT pco_id, first_name, last_name, enc_pii FROM pco_people WHERE org_id = ? AND pco_id IN (${ph})`).all(orgId, ...ids) as Array<{ pco_id: string; first_name: string | null; last_name: string | null; enc_pii: string | null }>) {
    out.set(r.pco_id, personLabel(r.first_name, r.last_name, r.enc_pii, r.pco_id));
  }
  return out;
}

/** Donors in a match state (for the audit reconciliation UI). */
export function listDonorsByStatus(orgId: number, status: string, limit = 500): DonorRow[] {
  const rows = getDb().prepare(
    `SELECT donor_key, enc, donor_stage, giving_channel, last_gift_on, last_gift_fund, match_status, person_id, candidate_ids
       FROM pushpay_donors WHERE org_id = ? AND match_status = ? ORDER BY donor_key LIMIT ?`,
  ).all(orgId, status, limit) as Array<{ donor_key: string; enc: string; donor_stage: string | null; giving_channel: string | null; last_gift_on: string | null; last_gift_fund: string | null; match_status: string; person_id: string | null; candidate_ids: string | null }>;
  const wanted = Array.from(new Set([
    ...rows.flatMap((r) => (r.candidate_ids ? (JSON.parse(r.candidate_ids) as string[]) : [])),
    ...rows.map((r) => r.person_id).filter((x): x is string => !!x),
  ]));
  const names = personNames(orgId, wanted);
  const ctx = candidateContext(orgId, wanted);
  return rows.map((r) => {
    const n = donorName(r.enc);
    const deh = n.email ? hmac(n.email.trim().toLowerCase()) : null;
    const np = normPhone(n.phone);
    const dph = np ? hmac(np) : null;
    const cand = (r.candidate_ids ? (JSON.parse(r.candidate_ids) as string[]) : []).map((id) => ({
      pcoId: id,
      name: names.get(id) ?? `#${id}`,
      sharesEmail: !!deh && (ctx.emails.get(id)?.has(deh) ?? false),
      sharesPhone: !!dph && (ctx.phones.get(id)?.has(dph) ?? false),
      active: ctx.active.has(id),
    }));
    return { donorKey: r.donor_key, ...n, stage: r.donor_stage, channel: r.giving_channel, lastGiftDate: r.last_gift_on, fund: r.last_gift_fund, status: r.match_status, personId: r.person_id, assignedName: r.person_id ? names.get(r.person_id) ?? `#${r.person_id}` : null, candidates: cand };
  });
}

/** Distinct people tied to at least one imported gift — the "has given"
 *  population that fills the Give next-step lane.
 *
 *  Reads the per-payer rollup, not `pushpay_donors`: the All Donors export was
 *  emptied on 2026-09-22 and giving now comes from the Transactions export.
 *  One person can hold several payer ids, hence DISTINCT. This counts people
 *  who gave inside the loaded gift window — the lane prints that window. */
export function countGivers(orgId: number): number {
  const r = getDb()
    .prepare(`SELECT COUNT(DISTINCT person_id) AS n FROM pushpay_payer_summary WHERE org_id = ? AND person_id IS NOT NULL`)
    .get(orgId) as { n: number } | undefined;
  return r?.n ?? 0;
}

/** Live counts per match_status (reflects manual reconciliation, unlike the
 *  import snapshot). Cheap GROUP BY, no decryption. */
export function countDonorsByStatus(orgId: number): { matched: number; manual: number; ambiguous: number; unmatched: number } {
  const rows = getDb()
    .prepare(`SELECT match_status, COUNT(*) AS n FROM pushpay_donors WHERE org_id = ? GROUP BY match_status`)
    .all(orgId) as Array<{ match_status: string; n: number }>;
  const out = { matched: 0, manual: 0, ambiguous: 0, unmatched: 0 };
  for (const r of rows) if (r.match_status in out) (out as Record<string, number>)[r.match_status] = r.n;
  return out;
}

export function assignDonor(orgId: number, donorKey: string, personId: string): void {
  getDb().prepare(`UPDATE pushpay_donors SET person_id = ?, match_status = 'manual' WHERE org_id = ? AND donor_key = ?`).run(personId, orgId, donorKey);
}

/** Clear a match → back to ambiguous (if it had candidates) or unmatched. */
export function clearDonorMatch(orgId: number, donorKey: string): void {
  getDb().prepare(
    `UPDATE pushpay_donors SET person_id = NULL, match_status = CASE WHEN candidate_ids IS NOT NULL THEN 'ambiguous' ELSE 'unmatched' END WHERE org_id = ? AND donor_key = ?`,
  ).run(orgId, donorKey);
}
