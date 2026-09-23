import "server-only";
import { getDb, prepareCached } from "./db";
import { decryptJson, encryptJson, hmac } from "./encryption";
import { firstNameSimilar, normNamePart, fullNameKey, organizationKey, looksLikeOrgName } from "./name-match";
import { normPhone } from "./phone";
import { givingMethodCase, givingPattern, lapseCutoff } from "./giving-sql";

// PushPay giving import + person matching. No API — an admin uploads a CSV
// export. TWO exports land here and one drop zone takes either (the header
// tells them apart):
//   * TRANSACTIONS — one row per gift, and the giving source for the whole
//     app. Gifts go to `pushpay_transactions` (no identity on them, ever,
//     0087) and each giver's identity and match decision to `pushpay_payers`,
//     keyed by PushPay's stable Payer ID (0100).
//   * ALL DONORS — one row per donor, into `pushpay_donors`. Emptied on
//     2026-09-22 and kept only for matching help: it has no donor id, so a
//     re-upload has to recognise every donor again from name, email and phone.
// Identity from either export is encrypted at rest; only keyed HMAC tokens are
// kept for matching (same approach as pco_person_emails). Matching combines
// three one-way signals — normalized name, email hash, and phone hash: anyone
// confirmed by two signals wins outright; a lone unique signal still matches;
// when signals point at several people (shared household email, same-name
// pair) the giver is flagged ambiguous for a human to decide.

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

/** A PushPay export date → "YYYY-MM-DD", or null if it cannot be read.
 *
 *  PushPay does not write one format. The All Donors export we first built
 *  against writes "31-Aug-26"; the Transactions export downloaded on
 *  2026-09-22 writes "9/16/2026" for every one of its 16,574 rows. Only the
 *  first was accepted, so that file imported nothing at all — silently, since
 *  a row with an unreadable date is skipped and the run still "succeeded".
 *
 *  Slash dates are read MONTH-FIRST, which is what PushPay's US exports emit
 *  (in that file the first component never exceeds 9 while the second reaches
 *  31). A date whose first component is above 12 is day-first, which this
 *  cannot tell apart from a month-first one for days 1-12 — so it is REFUSED
 *  rather than guessed, and the caller reports the file as unreadable instead
 *  of shifting every date in it. */
function parseDate(s: string): string | null {
  const v = (s || "").trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return v;
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(v);
  if (named) {
    const mon = MONTHS[named[2].toLowerCase()];
    if (!mon) return null;
    const yr = named[3].length === 4 ? Number(named[3]) : 2000 + Number(named[3]);
    return `${yr}-${String(mon).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (slash) {
    const a = Number(slash[1]), b = Number(slash[2]);
    if (a > 12 || b > 31 || a < 1 || b < 1) return null; // day-first, or not a date
    const yr = slash[3].length === 4 ? Number(slash[3]) : 2000 + Number(slash[3]);
    return `${yr}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }
  return null;
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
  // .iterate(), not .all(): reading all 34,674 people at once cost a measured
  // +51 MB of RSS on a process pm2 restarts at 150 MB, and every row is thrown
  // away as soon as its name is indexed. Streaming keeps one row alive at a
  // time. Same below for the emails and the phones.
  for (const p of db
    .prepare(`SELECT pco_id, first_name, last_name, nickname, legal_first_name, enc_pii, birth_year FROM pco_people WHERE org_id = ?`)
    .iterate(orgId) as IterableIterator<{
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
  for (const e of db.prepare(`SELECT email_hash, person_id FROM pco_person_emails WHERE org_id = ?`).iterate(orgId) as IterableIterator<{ email_hash: string; person_id: string }>) {
    (email.get(e.email_hash) ?? email.set(e.email_hash, []).get(e.email_hash)!).push(e.person_id);
    (emailsOf.get(e.person_id) ?? emailsOf.set(e.person_id, new Set()).get(e.person_id)!).add(e.email_hash);
  }
  const phone = new Map<string, string[]>();
  const phonesOf = new Map<string, Set<string>>();
  for (const ph of db.prepare(`SELECT phone_hash, person_id FROM pco_person_phones WHERE org_id = ?`).iterate(orgId) as IterableIterator<{ phone_hash: string; person_id: string }>) {
    (phone.get(ph.phone_hash) ?? phone.set(ph.phone_hash, []).get(ph.phone_hash)!).push(ph.person_id);
    (phonesOf.get(ph.person_id) ?? phonesOf.set(ph.person_id, new Set()).get(ph.person_id)!).add(ph.phone_hash);
  }
  const active = new Set<string>();
  for (const r of db.prepare(`SELECT person_id FROM person_activity WHERE org_id = ? AND classification <> 'inactive'`).iterate(orgId) as IterableIterator<{ person_id: string }>) {
    active.add(r.person_id);
  }
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
  const out = new Set<string>();
  // Streamed for the same reason buildMatchIndexes streams: the intermediate
  // array of 34,674 row objects is pure peak, and this runs on a 150 MB process.
  for (const r of getDb().prepare(`SELECT pco_id FROM pco_people WHERE org_id = ?`).iterate(orgId) as IterableIterator<{ pco_id: string }>) {
    out.add(r.pco_id);
  }
  return out;
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
  byPayerManual?: number;
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
        by_your_id, by_payer_manual, by_donor_manual, by_donor_match, first_gift_on, last_gift_on)
     VALUES (@org, @kind, @file, @total, @inserted, @matched, @ambiguous, @unmatched,
             @yourId, @payerManual, @donorManual, @donorMatch, @firstOn, @lastOn)`,
  ).run({
    org: orgId, kind, file: fileName,
    total: c.total, inserted: c.inserted, matched: c.matched, ambiguous: c.ambiguous, unmatched: c.unmatched,
    yourId: c.byYourId ?? 0, payerManual: c.byPayerManual ?? 0,
    donorManual: c.byDonorManual ?? 0, donorMatch: c.byDonorMatch ?? 0,
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
  /** Gifts placed by a hand match on the giver's PushPay profile (0100). */
  byPayerManual: number;
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
            by_your_id, by_payer_manual, by_donor_manual, by_donor_match,
            first_gift_on, last_gift_on, is_backfilled
       FROM pushpay_uploads WHERE org_id = ? ORDER BY imported_at DESC, id DESC`,
  ).all(orgId) as Array<{
    id: number; kind: string; file_name: string | null; imported_at: string;
    total: number; inserted: number; matched: number; ambiguous: number; unmatched: number;
    by_your_id: number; by_payer_manual: number; by_donor_manual: number; by_donor_match: number;
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
      byYourId: r.by_your_id, byPayerManual: r.by_payer_manual,
      byDonorManual: r.by_donor_manual, byDonorMatch: r.by_donor_match,
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

// ── The giver's PushPay profile ─────────────────────────────────────────────
//
// `pushpay_payers` (0100): one row per PushPay Payer ID — the stable giver key
// the All Donors export never had. It exists because the review queue had
// nothing to show: the giving surfaces count unlinked payers off the gift
// rollup, but 0087 deliberately stored no identity on a gift, so all an
// unplaceable giver left behind was an opaque id. The Transactions export
// carries First Name, Last Name, Suffix, Email and Mobile Number on every
// row; the importer parsed them to match on and threw them away. Now they are
// kept here, once per giver.
//
// STORED THE WAY THE REST OF THIS APP STORES IDENTITY. The name, email and
// phone live encrypted in one `enc` blob (encryptJson) and nowhere else — no
// plaintext column — with keyed HMACs beside it for matching, exactly as
// pushpay_donors did and as pco_person_emails does. Everything a page shows
// comes out of `enc`, which is why the review list is a TypeScript read and
// not stored builder SQL (the Page Builder's connection cannot decrypt).
//
// A PROFILE IS NOT A PERSON. One household can hold two PushPay profiles, so
// a count of these is never a count of people. User-facing copy says "giver"
// or "a giver's PushPay profile"; `payer_id` keeps PushPay's word because it
// is PushPay's column.
//
// WHY THE HUMAN DECISION LIVES HERE AND NOT ON THE ROLLUP.
// pushpay_payer_summary is derived — DELETE+INSERT from the gifts on every
// import and removal (refreshPushpayGiving) — so a match someone made by hand
// would be deleted by the next rebuild. Here it survives, and because the
// Payer ID is stable it survives with NO GUESSING AT ALL: the All Donors
// re-upload rule (sameDonor / planHandMatches) had to recognise a donor again
// from a name, an email and a phone, and sent them back to review whenever it
// could not. That whole problem is gone for a payer id.

/** matched — the matcher placed them; manual — a person did, and nothing
 *  automatic may overwrite it; ambiguous — several candidates, needs a human;
 *  unmatched — nobody to offer. */
export type PayerMatchStatus = "matched" | "manual" | "ambiguous" | "unmatched";

/** Where a resolved person came from. Every one of these is also written to
 *  `pushpay_transactions.match_source`, which is why 'your_id',
 *  'donor_manual', 'donor_match' and 'unmatched' keep the spellings 0087 and
 *  0098 gave them; 'payer_manual' is new with 0100. */
export type PayerMatchSource =
  | "your_id"
  | "payer_manual"
  | "donor_manual"
  | "donor_match"
  | "unmatched";

interface PayerDecision {
  personId: string | null;
  status: PayerMatchStatus;
  source: PayerMatchSource;
  /** The people to offer in review. Kept even on a match, so Unassign has
   *  something to fall back to. */
  candidates: string[] | null;
}

/** The decision a stored profile holds now (no decryption — just the verdict). */
interface StoredPayerDecision {
  personId: string | null;
  status: string;
  candidates: string[] | null;
}

function parseIds(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as string[]) : null;
  } catch {
    return null;
  }
}

/** Every stored profile's verdict for the org, keyed by payer id. Read inside
 *  the import's transaction, so a hand match made while the file was being
 *  matched is not lost between the read and the write. */
function readPayerDecisions(orgId: number): Map<string, StoredPayerDecision> {
  const out = new Map<string, StoredPayerDecision>();
  for (const r of getDb()
    .prepare(`SELECT payer_id, person_id, match_status, candidate_ids FROM pushpay_payers WHERE org_id = ?`)
    .all(orgId) as Array<{ payer_id: string; person_id: string | null; match_status: string; candidate_ids: string | null }>) {
    out.set(r.payer_id, { personId: r.person_id, status: r.match_status, candidates: parseIds(r.candidate_ids) });
  }
  return out;
}

/** What the stored profiles already know about each giver — the identity blob
 *  and the "Your ID" cell — keyed by payer id.
 *
 *  Read only when the uploaded file LEAVES A COLUMN OUT. A column the export
 *  does not carry is an absence of information, not an instruction to forget:
 *  PushPay's export builder lets you choose the columns, and a narrower export
 *  must not erase a name or a PCO id an earlier one supplied. */
function readStoredPayerIdentities(orgId: number): Map<string, { enc: string | null; yourId: string | null }> {
  const out = new Map<string, { enc: string | null; yourId: string | null }>();
  for (const r of getDb()
    .prepare(`SELECT payer_id, enc, your_id FROM pushpay_payers WHERE org_id = ?`)
    .iterate(orgId) as IterableIterator<{ payer_id: string; enc: string | null; your_id: string | null }>) {
    out.set(r.payer_id, { enc: r.enc, yourId: r.your_id });
  }
  return out;
}

const PAYER_UPSERT_SQL = `INSERT INTO pushpay_payers
  (org_id, payer_id, enc, name_hash, export_name_hash, email_hash, phone_hash, your_id,
   person_id, match_status, match_source, candidate_ids, first_seen_at, last_seen_at)
 VALUES (@org, @payer, @enc, @nameHash, @exportNameHash, @emailHash, @phoneHash, @yourId,
   @personId, @status, @source, @candidates, @now, @now)
 ON CONFLICT(org_id, payer_id) DO UPDATE SET
   enc = excluded.enc, name_hash = excluded.name_hash,
   export_name_hash = excluded.export_name_hash, email_hash = excluded.email_hash,
   phone_hash = excluded.phone_hash, your_id = excluded.your_id,
   person_id = excluded.person_id, match_status = excluded.match_status,
   match_source = excluded.match_source, candidate_ids = excluded.candidate_ids,
   last_seen_at = excluded.last_seen_at`;

/** `first_seen_at` is set on insert and never moved, so it keeps meaning "the
 *  import that first carried this giver"; `last_seen_at` moves every time. */
function upsertPayer(
  orgId: number,
  payerId: string,
  id: { first: string; last: string; email: string; phone: string; identity: DonorIdentity; yourId: string },
  d: PayerDecision,
  now: string,
): void {
  prepareCached(PAYER_UPSERT_SQL).run({
    org: orgId,
    payer: payerId,
    enc: encryptJson({ firstName: id.first, lastName: id.last, email: id.email, phone: id.phone } as DonorPII),
    nameHash: id.identity.bucket,
    exportNameHash: id.identity.name,
    emailHash: id.identity.email,
    phoneHash: id.identity.phone,
    yourId: id.yourId || null,
    personId: d.personId,
    status: d.status,
    source: d.source,
    candidates: d.candidates && d.candidates.length ? JSON.stringify(d.candidates) : null,
    now,
  });
}

/** Every gift of one giver, without the un-indexable
 *  `COALESCE(payer_id, 'tx:' || transaction_id)`: a real payer id uses
 *  pushpay_tx_payer, and a 'tx:' key is one gift, found by its primary key. */
function stampPayerGifts(orgId: number, payerId: string, personId: string | null, source: PayerMatchSource): number {
  const tx = payerId.startsWith("tx:") ? payerId.slice(3) : null;
  const sql = tx
    ? `UPDATE pushpay_transactions SET person_id = @person, match_source = @source
        WHERE org_id = @org AND transaction_id = @tx AND payer_id IS NULL
          AND (person_id IS NOT @person OR match_source IS NOT @source)`
    : `UPDATE pushpay_transactions SET person_id = @person, match_source = @source
        WHERE org_id = @org AND payer_id = @payer
          AND (person_id IS NOT @person OR match_source IS NOT @source)`;
  return prepareCached(sql).run({ org: orgId, payer: payerId, tx, person: personId, source }).changes;
}

/** How many of one giver's gifts point at somebody OTHER than `personId`
 *  (including nobody, when `personId` is a person, and somebody, when it is
 *  null). Asked immediately before a restamp, so it is the exact number of
 *  gifts that restamp will move — `changes` from the UPDATE itself also counts
 *  a row whose person is unchanged and whose match_source is being corrected. */
function countPayerGiftsNotOn(orgId: number, payerId: string, personId: string | null): number {
  const tx = payerId.startsWith("tx:") ? payerId.slice(3) : null;
  const sql = tx
    ? `SELECT COUNT(*) AS n FROM pushpay_transactions
        WHERE org_id = @org AND transaction_id = @tx AND payer_id IS NULL AND person_id IS NOT @person`
    : `SELECT COUNT(*) AS n FROM pushpay_transactions
        WHERE org_id = @org AND payer_id = @payer AND person_id IS NOT @person`;
  return (prepareCached(sql).get({ org: orgId, payer: payerId, tx, person: personId }) as { n: number }).n;
}

/** Read a stored profile's identity back out of `enc`. */
function payerIdentityOf(enc: string | null): { first: string; last: string; email: string; phone: string; identity: DonorIdentity } {
  const p = decryptJson<DonorPII>(enc ?? null);
  const first = p?.firstName ?? "";
  const last = p?.lastName ?? "";
  const email = p?.email ?? "";
  const phone = p?.phone ?? "";
  return { first, last, email, phone, identity: donorIdentity(first, last, email, phone) };
}

/** Resolve a giver automatically: "Your ID" first, because it IS the PCO
 *  person id and so beats any guess, then decideMatch on the name, email and
 *  phone under Dan's rules (name agreement mandatory with nickname variants,
 *  inactive not disqualifying, duplicate PCO records interchangeable, anything
 *  genuinely ambiguous goes to review with its candidates).
 *
 *  This is what Unassign and Re-match fall back to. It does not consult the
 *  All Donors hand matches: that step only ever applied at import time, needs
 *  the whole file to weigh a donor against, and pushpay_donors is empty. */
function resolvePayerAutomatically(
  id: { first: string; last: string; identity: DonorIdentity; yourId: string },
  ix: MatchIndexes,
  knownPerson: Set<string>,
): PayerDecision {
  if (id.yourId && knownPerson.has(id.yourId)) {
    return { personId: id.yourId, status: "matched", source: "your_id", candidates: null };
  }
  const dec = id.first || id.last
    ? decideMatch(id.first, id.last, id.identity.email, id.identity.phone, ix)
    : { personId: null, status: "unmatched", candidates: null as string[] | null };
  const candidates = dec.candidates && dec.candidates.length ? dec.candidates : null;
  if (dec.personId) return { personId: dec.personId, status: "matched", source: "donor_match", candidates };
  return { personId: null, status: candidates ? "ambiguous" : "unmatched", source: "unmatched", candidates };
}

/** A hand match is never overwritten — that is the whole point of storing it
 *  against a stable id. The one exception is a hand match naming a person who
 *  has since left pco_people: it cannot be honoured, and leaving it would put
 *  the profile and its gifts on a person the app no longer has, so the giver
 *  falls back to automatic matching. (pco_people keeps people PCO merged away,
 *  and the junk filter spares anyone this table names, so this should not
 *  happen.) */
function applyStoredHandMatch(
  stored: StoredPayerDecision | undefined,
  auto: PayerDecision,
  knownPerson: Set<string>,
): PayerDecision {
  if (!stored || stored.status !== "manual" || !stored.personId) return auto;
  if (!knownPerson.has(stored.personId)) return auto;
  return {
    personId: stored.personId,
    status: "manual",
    source: "payer_manual",
    candidates: stored.candidates ?? auto.candidates,
  };
}

export interface TransactionImportResult {
  total: number;
  inserted: number;
  byYourId: number;
  /** Gifts placed by a hand match on the giver's own PushPay profile
   *  (match_source 'payer_manual'). Keyed by Payer ID, so the decision is
   *  recognised outright rather than guessed at (0100). */
  byPayerManual: number;
  /** A giver with no usable Your ID who is a donor matched by hand on the All
   *  Donors list (match_source 'donor_manual'). */
  byDonorManual: number;
  byDonorMatch: number;
  unmatched: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Givers in the file whose identity this import stored (0100): every payer
   *  it saw. The review queue can only list a giver it has a name for. */
  payersStored: number;
  /** Of those, the ones still waiting for a person — what the queue will show. */
  payersToPlace: number;
  /** Gifts the file did NOT contain whose person changed anyway, because the
   *  giver they belong to resolved differently this time. Reported rather than
   *  done silently: an import can move — or drop — giving from windows nobody
   *  was looking at. `earlierGiftsUnlinked` is the direction that loses a link. */
  earlierGiftsRelinked: number;
  earlierGiftsUnlinked: number;
}

/** Does this CSV look like the Transactions export rather than All Donors? */
export function isTransactionsExport(csvText: string): boolean {
  const first = csvText.slice(0, 4096).split(/\r?\n/)[0]?.toLowerCase() ?? "";
  return first.includes("transaction id") && first.includes("received on");
}

/** Import the PushPay Transactions export — one row per gift.
 *
 *  Resolution happens ONCE PER GIVER, keyed by PushPay's Payer ID, and every
 *  one of that giver's gifts takes the answer. The order:
 *    1. A hand match already stored against that Payer ID (0100). A human
 *       decision is never overwritten, and because the Payer ID is stable it
 *       survives every future upload with no guessing at all — unlike the All
 *       Donors list, which had to recognise a donor again from a name, an
 *       email and a phone and sent them back to review when it could not.
 *       match_source 'payer_manual'.
 *    2. "Your ID" is the church's own id on the giver's PushPay record, and it
 *       IS the PCO person id: 1,113 of 1,140 distinct values in the September
 *       2026 export resolve against pco_people. A direct link beats a guess.
 *    3. Otherwise, a donor someone matched by hand on the All Donors list, when
 *       the giver is that same donor by the rule a re-upload uses to carry
 *       hand matches over (sameDonor / planHandMatches: the same name, Jr or
 *       Sr included, plus the same email or phone, or the name alone when
 *       neither has either and it is on one payer and one donor only), every
 *       hand match they could be names the same person, that person is still
 *       in pco_people, and nothing casts doubt on it: a giver whose email or
 *       phone differ from the donor's needs no other giver with that name
 *       who could be the donor instead, and no other person with that name
 *       holding more of that email and phone. match_source 'donor_manual'.
 *       (Nothing can reach this today: pushpay_donors is empty. It is kept so
 *       the All Donors path still works if that export is ever loaded again.)
 *    4. Otherwise the same name/email/phone matching the donor import uses
 *       (decideMatch), under Dan's rules — name agreement mandatory with
 *       nickname variants, inactive not disqualifying, duplicate PCO records
 *       interchangeable, anything genuinely ambiguous left for a human with
 *       its candidates: 'donor_match', or 'unmatched'/'ambiguous'.
 *
 *  THE IDENTITY IS KEPT. Every giver the file carries gets a pushpay_payers
 *  row holding their name, email and phone encrypted, their match hashes, the
 *  decision above and its candidates, so the review queue has something to
 *  show and a person to show it about. The gifts themselves still store no
 *  identity at all (0087).
 *
 *  Upsert rather than replace: the export is a window (the sample covers
 *  January to September 2026), so re-importing a later window must add to the
 *  history rather than delete everything outside it. Transaction ID is stable,
 *  so a gift seen twice updates in place — and re-uploading a file already
 *  loaded is therefore safe, which is exactly how an operator fills in
 *  identities for gifts imported before this code existed. */
export function importPushpayTransactions(
  orgId: number,
  fileName: string,
  csvText: string,
): TransactionImportResult {
  let rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) {
    return {
      total: 0, inserted: 0, byYourId: 0, byPayerManual: 0, byDonorManual: 0, byDonorMatch: 0,
      unmatched: 0, firstDate: null, lastDate: null, payersStored: 0, payersToPlace: 0,
      earlierGiftsRelinked: 0, earlierGiftsUnlinked: 0,
    };
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

  // ── What this file is allowed to re-decide ────────────────────────────────
  //
  // PushPay's export builder lets you choose the columns, and the import
  // resolves a giver from the columns it finds: "Your ID" (the PCO person id
  // the church put on the giver's PushPay record), then the name, email and
  // phone. Every one of that giver's gifts then takes the answer — including
  // gifts from windows this file does not contain, because the queue, the
  // rollup and the Give lane have to agree about who a giver is.
  //
  // That is why a file's column set matters far beyond its own rows. A file
  // that cannot identify anyone would not just import 1,000 unmatched gifts,
  // it would UNLINK the whole history of every giver it lists. Measured on a
  // copy of production: a September-only export with the "Your ID" column
  // left out took gifts with no person from 2,948 to 13,862 and unlinked
  // givers from 548 to 1,143, silently, in 1.1 seconds. So the two cases
  // where the file cannot say who gave are refused before anything is read
  // or written, with the export to run instead.
  if (iYour < 0 && iF < 0 && iL < 0) {
    throw new Error(
      "That export has no Your ID column and no name columns, so it cannot say who gave — " +
        "importing it would unlink the gifts already matched. Re-export the Transactions " +
        "report from PushPay with Your ID, First Name and Last Name included.",
    );
  }
  if (iYour < 0) {
    const linked = (db
      .prepare(`SELECT COUNT(*) AS n FROM pushpay_transactions WHERE org_id = ? AND match_source = 'your_id'`)
      .get(orgId) as { n: number }).n;
    if (linked > 0) {
      throw new Error(
        `That export has no Your ID column, and ${linked.toLocaleString()} gifts here are matched to a person by it — ` +
          "importing this file would re-decide those givers from their names alone and unlink the ones it could not " +
          "place. Re-export the Transactions report from PushPay with the Your ID column included.",
      );
    }
  }

  const ix = buildMatchIndexes(orgId);
  const knownPerson = knownPeople(orgId);

  const out: TransactionImportResult = {
    total: 0, inserted: 0, byYourId: 0, byPayerManual: 0, byDonorManual: 0, byDonorMatch: 0,
    unmatched: 0, firstDate: null, lastDate: null, payersStored: 0, payersToPlace: 0,
    earlierGiftsRelinked: 0, earlierGiftsUnlinked: 0,
  };
  // Giver -> person decided once per PAYER ID, not once per gift: a giver with
  // 40 gifts should cost one matching decision, and every one of their rows
  // must land on the same person. A giver is known by the details on their
  // first gift in the file — PushPay writes one name and one email per payer.
  const payers = new Map<string, {
    yourId: string; first: string; last: string; email: string; phone: string; identity: DonorIdentity;
  }>();
  const gifts: Array<{
    txId: string; date: string; status: string | null; source: string | null;
    payer: string | null; payerKey: string; fundName: string | null; fundCode: string | null;
  }> = [];

  // Rows whose "Received On" we cannot read, and the first such value, so the
  // file can be refused by name rather than importing as an empty dataset.
  let skippedNoDate = 0;
  let unreadableDate: string | null = null;

  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const txId = (r[iTx] ?? "").trim();
    const date = parseDate(r[iDate] ?? "");
    if (!txId) continue;
    if (!date) {
      // Keep the unreadable value to name it in the error below: a file whose
      // dates we cannot read must fail loudly, not import as an empty dataset
      // and reset the "last import" card to zeros.
      if (unreadableDate === null) unreadableDate = (r[iDate] ?? "").trim();
      skippedNoDate++;
      continue;
    }
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
        first, last, email, phone, identity: donorIdentity(first, last, email, phone),
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

  // A Transactions file we cannot read a single date from is a format we do not
  // understand, not an empty export: PushPay writes "31-Aug-26" on one export
  // and "9/16/2026" on another. Refuse it, naming the value, instead of
  // recording a 0-gift dataset and blanking the last-import card.
  if (out.total === 0 && skippedNoDate > 0) {
    throw new Error(
      `Could not read any gift date in this file (${skippedNoDate.toLocaleString()} rows, first value ${JSON.stringify(unreadableDate)}). ` +
        `Expected a date like 9/16/2026 or 16-Sep-26. Nothing was imported.`,
    );
  }

  // The parsed cells are now in `payers` and `gifts`; on the real export that
  // is 16,574 rows of 19 strings kept alive for no reason on a process capped
  // at 150 MB. Let them go before the matching starts.
  rows = [];

  // A column this file leaves out must not erase what an earlier one supplied
  // (see the refusals above: the two cases where nothing is left to go on are
  // refused outright, and this is the same principle applied field by field).
  // Only paid for when something really is missing.
  if (iYour < 0 || (iF < 0 && iL < 0) || iE < 0 || iP < 0) {
    const stored = readStoredPayerIdentities(orgId);
    for (const [k, p] of payers) {
      const st = stored.get(k);
      if (!st) continue;
      const was = payerIdentityOf(st.enc);
      if (iYour < 0 && st.yourId) p.yourId = st.yourId;
      if (iF < 0 && iL < 0) { p.first = was.first; p.last = was.last; }
      if (iE < 0 && was.email) p.email = was.email;
      if (iP < 0 && was.phone) p.phone = was.phone;
      p.identity = donorIdentity(p.first, p.last, p.email, p.phone);
    }
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
  // The automatic answer for every giver, decided outside the transaction
  // (decideMatch walks the match indexes, and the write lock should not be
  // held for that). A stored hand match overrides it inside the transaction,
  // where it is read — so a match someone makes while the file is being
  // matched is not lost between the read and the write.
  const auto = new Map<string, PayerDecision>();
  payerKeys.forEach((k, i) => {
    const p = payers.get(k)!;
    const handMatch = hand.outcome[i];
    if (p.yourId && knownPerson.has(p.yourId)) {
      auto.set(k, { personId: p.yourId, status: "matched", source: "your_id", candidates: null });
    } else if (handMatch?.kind === "keep") {
      // Carried from the All Donors list: a human decision too, so it is
      // stored as 'manual' and nothing automatic overwrites it later either.
      auto.set(k, { personId: handMatch.personId, status: "manual", source: "donor_manual", candidates: null });
    } else {
      const dec = resolvePayerAutomatically(p, ix, knownPerson);
      // A donor the All Donors carry could not place still names the people it
      // was torn between: offer them in review alongside the matcher's own.
      const review = handMatch?.kind === "review" ? handMatch.personIds : [];
      const candidates = [...new Set([...review, ...(dec.candidates ?? [])])];
      auto.set(k, {
        ...dec,
        status: dec.personId ? dec.status : candidates.length ? "ambiguous" : "unmatched",
        candidates: candidates.length ? candidates : null,
      });
    }
  });

  // One transaction: the upload's record, its gifts, and the rollup rebuilt
  // from them all commit together, or none of them do. IMMEDIATE because it
  // reads (the row count, to tell new gifts from re-supplied ones) before it
  // writes, and a transaction that reads first cannot wait out another writer.
  const run = db.transaction(() => {
    const countRows = db.prepare(`SELECT COUNT(*) AS n FROM pushpay_transactions WHERE org_id = ?`);
    const before = (countRows.get(orgId) as { n: number }).n;

    // A hand match stored against the Payer ID wins over everything above.
    // Read here, inside the write lock, so one made while the file was being
    // matched is not lost between the read and the write.
    const stored = readPayerDecisions(orgId);
    const decided = new Map<string, PayerDecision>();
    for (const k of payerKeys) {
      decided.set(k, applyStoredHandMatch(stored.get(k), auto.get(k)!, knownPerson));
    }

    // Counted per GIFT, the way the upload history has always counted, but off
    // the giver's one decision. Counted in place rather than into a second
    // array of 16,574 objects — the numbers are needed before the upload row
    // is written, the rows themselves not until after it.
    for (const g of gifts) {
      const d = decided.get(g.payerKey)!;
      if (d.source === "your_id") out.byYourId++;
      else if (d.source === "payer_manual") out.byPayerManual++;
      else if (d.source === "donor_manual") out.byDonorManual++;
      else if (d.source === "donor_match") out.byDonorMatch++;
      else out.unmatched++;
    }
    out.payersStored = payerKeys.length;
    out.payersToPlace = payerKeys.filter((k) => decided.get(k)!.personId === null).length;

    const matched = out.byYourId + out.byPayerManual + out.byDonorManual + out.byDonorMatch;
    const uploadId = recordUpload(orgId, "transactions", fileName, {
      total: out.total, inserted: 0, matched, ambiguous: 0, unmatched: out.unmatched,
      byYourId: out.byYourId, byPayerManual: out.byPayerManual,
      byDonorManual: out.byDonorManual, byDonorMatch: out.byDonorMatch,
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
    for (const g of gifts) {
      const d = decided.get(g.payerKey)!;
      ins.run(orgId, g.txId, g.date, g.status, g.source, g.payer, d.personId, d.source, g.fundName, g.fundCode, uploadId, uploadId);
      link.run(orgId, g.txId, uploadId);
    }
    // The givers themselves: identity, hashes and the decision, one row per
    // Payer ID. This is the only place a Transactions import stores a name.
    const now = new Date().toISOString();
    for (const k of payerKeys) upsertPayer(orgId, k, payers.get(k)!, decided.get(k)!, now);
    // A giver's gifts from EARLIER windows are not in this file, so the insert
    // above never touched them. Restamp them too, or the rollup — which takes
    // the person from the payer's most recently imported gift that names
    // anyone — could keep showing a person this import no longer resolves to,
    // and the review queue and the Give lane would disagree. The statement
    // skips rows that already agree, so the gifts just written cost nothing.
    //
    // Every row it changes is a gift this file did NOT carry: the gifts just
    // written already hold the giver's answer, and the statement skips rows
    // that agree. So its count is exactly "giving from earlier windows that
    // moved", which the import result reports rather than leaving silent.
    for (const k of payerKeys) {
      const d = decided.get(k)!;
      const moving = countPayerGiftsNotOn(orgId, k, d.personId);
      stampPayerGifts(orgId, k, d.personId, d.source);
      if (moving > 0) {
        if (d.personId === null) out.earlierGiftsUnlinked += moving;
        else out.earlierGiftsRelinked += moving;
      }
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

// ── The review queue ────────────────────────────────────────────────────────
//
// What /audit/pushpay reads and writes. It works on pushpay_payers, the giver
// profiles the import stores, and joins each one to its giving in the loaded
// window from pushpay_payer_summary — so a row shows who the giver is AND what
// placing them would attach to a person.
//
// THE COUNTS AGREE WITH THE GIVING PAGE BY CONSTRUCTION. A profile holds a
// person or it does not: 'matched' and 'manual' hold one, 'ambiguous' and
// 'unmatched' do not. So needs-review plus unmatched is exactly the giving
// page's "Unlinked givers" — for every giver an import has actually seen.
// getPayerIdentityCoverage is what says whether that qualifier bites.

/** How much of the gift data has a giver profile behind it. Identity only
 *  exists for givers an import running this code has seen, so before the next
 *  upload the queue can be empty while the giving page counts hundreds
 *  unlinked. The page says so rather than showing an empty list that looks
 *  like "nothing to do". */
export interface PayerIdentityCoverage {
  /** Giver profiles behind the loaded gifts (pushpay_payer_summary). */
  payers: number;
  /** Of those, how many have a NAME stored and so can be listed. A profile
   *  with a row but no name (an export that carried Your ID and no name
   *  columns) is not listable and must not count here, or the honest empty
   *  state below would be replaced by a list of nameless rows. */
  withIdentity: number;
  /** Profiles with no person attached — the giving page's "Unlinked givers". */
  unlinked: number;
  /** Of those, the ones the queue can actually show. The rest need a re-upload. */
  unlinkedWithIdentity: number;
}

export function getPayerIdentityCoverage(orgId: number): PayerIdentityCoverage {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS payers,
              COALESCE(SUM(CASE WHEN p.name_hash IS NULL THEN 0 ELSE 1 END), 0) AS withIdentity,
              COALESCE(SUM(CASE WHEN s.person_id IS NULL THEN 1 ELSE 0 END), 0) AS unlinked,
              COALESCE(SUM(CASE WHEN s.person_id IS NULL AND p.name_hash IS NOT NULL THEN 1 ELSE 0 END), 0) AS unlinkedWithIdentity
         FROM pushpay_payer_summary s
         LEFT JOIN pushpay_payers p ON p.org_id = s.org_id AND p.payer_id = s.payer_id
        WHERE s.org_id = ?`,
    )
    .get(orgId) as { payers: number; withIdentity: number; unlinked: number; unlinkedWithIdentity: number };
  return r;
}

/** Live counts per match status, over the givers who still have gifts.
 *
 *  The join is what keeps the tabs honest against the giving page. A profile
 *  can outlive its gifts — a gift re-supplied WITH a Payer ID leaves the
 *  'tx:<id>' profile it used to key behind, and removing a dataset can delete
 *  a giver's last gift — and counting those would put a number on the tab that
 *  the "Unlinked givers" stat, which counts the gift rollup, cannot match.
 *  There is nothing to place on such a giver anyway: no gift would move.
 *  listPayersByStatus joins the same way, so a tab's count is exactly what it
 *  lists.
 *
 *  `name_hash IS NOT NULL` for the same reason. A profile with no name — an
 *  export that carried Your ID and no name columns — cannot be shown to
 *  anyone as a row they could judge, so it is not counted as work either.
 *  getPayerIdentityCoverage is what reports those separately, and the page
 *  tells the reader how many of the giving page's total are in that state. */
export function countPayersByStatus(orgId: number): {
  matched: number;
  manual: number;
  ambiguous: number;
  unmatched: number;
} {
  const out = { matched: 0, manual: 0, ambiguous: 0, unmatched: 0 };
  for (const r of getDb()
    .prepare(
      `SELECT p.match_status, COUNT(*) AS n
         FROM pushpay_payers p
         JOIN pushpay_payer_summary s ON s.org_id = p.org_id AND s.payer_id = p.payer_id
        WHERE p.org_id = ? AND p.name_hash IS NOT NULL GROUP BY p.match_status`,
    )
    .all(orgId) as Array<{ match_status: string; n: number }>) {
    if (r.match_status in out) (out as Record<string, number>)[r.match_status] = r.n;
  }
  return out;
}

export interface PayerReviewRow {
  payerId: string;
  /** The giver as their PushPay profile spells them, decrypted from `enc`. */
  fullName: string;
  email: string;
  phone: string;
  status: string;
  matchSource: string | null;
  personId: string | null;
  assignedName: string | null;
  /** Their giving in the loaded window. Counts of gifts — never an amount. */
  gifts: number;
  firstGiftOn: string | null;
  lastGiftOn: string | null;
  /** Recurring schedule / Not on a schedule / Lapsed — our words (giving-sql). */
  pattern: string | null;
  /** Online / Check or cash / Both. */
  method: string | null;
  /** The funds they have given to, comma-separated. */
  funds: string | null;
  /** The imports that first and last carried this giver. */
  firstSeenAt: string;
  lastSeenAt: string;
  candidates: Array<{ pcoId: string; name: string; sharesEmail: boolean; sharesPhone: boolean; active: boolean }>;
}

/** Givers in one match state, biggest givers first — placing someone with 40
 *  gifts is worth more than placing someone with one.
 *
 *  Joined to the gift rollup, not left-joined: a profile whose gifts have all
 *  gone is not work — placing it would move nothing — and counting it would
 *  break the agreement between these tabs and the giving page's stat.
 *
 *  `method` is read per giver with the payer id, never with
 *  `COALESCE(payer_id, 'tx:' || transaction_id)`: that expression cannot use
 *  pushpay_tx_payer, and 500 scans of 16k gifts is not a page render. A 'tx:'
 *  key is one gift, found by the primary key. */
export function listPayersByStatus(orgId: number, status: string, limit = 500): PayerReviewRow[] {
  const db = getDb();
  const method = (where: string) =>
    `(SELECT ${givingMethodCase(
      `MAX(CASE WHEN t.source = 'Batch Entry' THEN 1 ELSE 0 END)`,
      `MAX(CASE WHEN t.source IS NULL OR t.source <> 'Batch Entry' THEN 1 ELSE 0 END)`,
    )} FROM pushpay_transactions t WHERE t.org_id = p.org_id AND ${where})`;
  const rows = db
    .prepare(
      `SELECT p.payer_id, p.enc, p.person_id, p.match_status, p.match_source, p.candidate_ids,
              p.first_seen_at, p.last_seen_at,
              s.gifts, s.recurring_gifts, s.first_gift_on, s.last_gift_on, s.funds,
              CASE WHEN p.payer_id LIKE 'tx:%'
                   THEN ${method(`t.transaction_id = substr(p.payer_id, 4) AND t.payer_id IS NULL`)}
                   ELSE ${method(`t.payer_id = p.payer_id`)} END AS method
         FROM pushpay_payers p
         JOIN pushpay_payer_summary s ON s.org_id = p.org_id AND s.payer_id = p.payer_id
        WHERE p.org_id = ? AND p.match_status = ? AND p.name_hash IS NOT NULL
        ORDER BY s.gifts DESC, s.last_gift_on DESC, p.payer_id
        LIMIT ?`,
    )
    .all(orgId, status, limit) as Array<{
    payer_id: string;
    enc: string | null;
    person_id: string | null;
    match_status: string;
    match_source: string | null;
    candidate_ids: string | null;
    first_seen_at: string;
    last_seen_at: string;
    gifts: number | null;
    recurring_gifts: number | null;
    first_gift_on: string | null;
    last_gift_on: string | null;
    funds: string | null;
    method: string | null;
  }>;

  const wanted = Array.from(
    new Set([
      ...rows.flatMap((r) => parseIds(r.candidate_ids) ?? []),
      ...rows.map((r) => r.person_id).filter((x): x is string => !!x),
    ]),
  );
  const names = personNames(orgId, wanted);
  const ctx = candidateContext(orgId, wanted);
  const cutoff = (db.prepare(`SELECT ${lapseCutoff("?")} AS cutoff`).get(orgId) as { cutoff: string | null }).cutoff;

  return rows.map((r) => {
    const id = payerIdentityOf(r.enc);
    const cand = (parseIds(r.candidate_ids) ?? []).map((pid) => ({
      pcoId: pid,
      name: names.get(pid) ?? `#${pid}`,
      // PCO emails and phones are stored only as one-way hashes, so we cannot
      // show the values — but we can say whether a candidate holds the same
      // hash as the giver, which is what makes a candidate obviously right.
      sharesEmail: !!id.identity.email && (ctx.emails.get(pid)?.has(id.identity.email) ?? false),
      sharesPhone: !!id.identity.phone && (ctx.phones.get(pid)?.has(id.identity.phone) ?? false),
      active: ctx.active.has(pid),
    }));
    return {
      payerId: r.payer_id,
      fullName: [id.first, id.last].filter(Boolean).join(" ").trim() || "(no name in the export)",
      email: id.email,
      phone: id.phone,
      status: r.match_status,
      matchSource: r.match_source,
      personId: r.person_id,
      assignedName: r.person_id ? names.get(r.person_id) ?? `#${r.person_id}` : null,
      gifts: r.gifts ?? 0,
      firstGiftOn: r.first_gift_on,
      lastGiftOn: r.last_gift_on,
      pattern: r.gifts ? givingPattern(r.last_gift_on, r.recurring_gifts ?? 0, cutoff) : null,
      method: r.method,
      funds: fundsLabel(r.funds),
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      candidates: cand,
    };
  });
}

/** `pushpay_payer_summary.funds` is a sorted JSON array of fund names. */
function fundsLabel(json: string | null): string | null {
  const v = parseIds(json);
  return v && v.length ? v.join(", ") : null;
}

/** Place a giver on a person by hand.
 *
 *  One transaction: the profile, every one of that giver's gifts, and the
 *  rollups the giving page and the Give lane read. They cannot be left
 *  disagreeing, and the page the operator returns to is right immediately.
 *  IMMEDIATE because it reads the person and the profile before it writes. */
export function assignPayer(orgId: number, payerId: string, personId: string): void {
  const db = getDb();
  db.transaction(() => {
    const person = db
      .prepare(`SELECT 1 AS ok FROM pco_people WHERE org_id = ? AND pco_id = ?`)
      .get(orgId, personId) as { ok: number } | undefined;
    if (!person) throw new Error("That person is no longer in Planning Center's people — pick another record.");
    const r = db
      .prepare(
        `UPDATE pushpay_payers
            SET person_id = ?, match_status = 'manual', match_source = 'payer_manual'
          WHERE org_id = ? AND payer_id = ?`,
      )
      .run(personId, orgId, payerId);
    if (r.changes === 0) {
      throw new Error("That giver is not in the review queue any more — reload the page.");
    }
    stampPayerGifts(orgId, payerId, personId, "payer_manual");
    refreshPushpayGiving(orgId);
  }).immediate();
}

/** Hand a giver back to automatic matching: "Your ID" if their PushPay record
 *  carries one that resolves, otherwise name / email / phone matching. So
 *  Unassign is an undo of the hand match, not a blanket "nobody" — if the
 *  export already said who they are, that is what comes back. Same
 *  transaction, same rollup rebuild, so nothing is left half-changed. */
export function clearPayerMatch(orgId: number, payerId: string): void {
  const db = getDb();
  const row = db
    .prepare(`SELECT enc, your_id FROM pushpay_payers WHERE org_id = ? AND payer_id = ?`)
    .get(orgId, payerId) as { enc: string | null; your_id: string | null } | undefined;
  if (!row) throw new Error("That giver is not in the review queue any more — reload the page.");
  const id = { ...payerIdentityOf(row.enc), yourId: row.your_id ?? "" };

  // "Your ID" needs one row, not the whole match index — and building that
  // index reads every person, email and phone in the org on a process capped
  // at 150 MB. Only pay for it when the name is the only thing left to go on.
  const yourIdPerson =
    id.yourId &&
    (db.prepare(`SELECT 1 AS ok FROM pco_people WHERE org_id = ? AND pco_id = ?`).get(orgId, id.yourId) as
      | { ok: number }
      | undefined)
      ? id.yourId
      : null;
  const decision: PayerDecision = yourIdPerson
    ? { personId: yourIdPerson, status: "matched", source: "your_id", candidates: null }
    : resolvePayerAutomatically(id, buildMatchIndexes(orgId), knownPeople(orgId));

  db.transaction(() => {
    db.prepare(
      `UPDATE pushpay_payers
          SET person_id = ?, match_status = ?, match_source = ?, candidate_ids = ?
        WHERE org_id = ? AND payer_id = ?`,
    ).run(
      decision.personId,
      decision.status,
      decision.source,
      decision.candidates && decision.candidates.length ? JSON.stringify(decision.candidates) : null,
      orgId,
      payerId,
    );
    stampPayerGifts(orgId, payerId, decision.personId, decision.source);
    refreshPushpayGiving(orgId);
  }).immediate();
}

export interface PayerRematchResult {
  total: number;
  matched: number;
  manual: number;
  ambiguous: number;
  unmatched: number;
  /** Profiles whose person or status moved. */
  changed: number;
}

/** Re-run matching over the stored giver profiles with the current rules and
 *  the latest PCO people — no re-upload. Hand matches are left exactly as they
 *  are, which is the whole reason they are stored against a stable id.
 *
 *  Gifts are restamped and the rollups rebuilt for every profile that moved,
 *  in the same transaction, so nothing can be left describing a link that is
 *  no longer there. */
export function rematchPayers(orgId: number): PayerRematchResult {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT payer_id, enc, your_id, person_id, match_status
         FROM pushpay_payers WHERE org_id = ? AND match_status <> 'manual'`,
    )
    .all(orgId) as Array<{
    payer_id: string;
    enc: string | null;
    your_id: string | null;
    person_id: string | null;
    match_status: string;
  }>;
  const ix = buildMatchIndexes(orgId);
  const known = knownPeople(orgId);
  const decisions = rows.map((r) => ({
    payerId: r.payer_id,
    was: { personId: r.person_id, status: r.match_status },
    now: resolvePayerAutomatically({ ...payerIdentityOf(r.enc), yourId: r.your_id ?? "" }, ix, known),
  }));

  let changed = 0;
  db.transaction(() => {
    const upd = db.prepare(
      `UPDATE pushpay_payers
          SET person_id = ?, match_status = ?, match_source = ?, candidate_ids = ?
        WHERE org_id = ? AND payer_id = ?`,
    );
    for (const d of decisions) {
      if (d.now.personId !== d.was.personId || d.now.status !== d.was.status) changed++;
      upd.run(
        d.now.personId,
        d.now.status,
        d.now.source,
        d.now.candidates && d.now.candidates.length ? JSON.stringify(d.now.candidates) : null,
        orgId,
        d.payerId,
      );
      stampPayerGifts(orgId, d.payerId, d.now.personId, d.now.source);
    }
    refreshPushpayGiving(orgId);
  }).immediate();

  const c = countPayersByStatus(orgId);
  return {
    total: c.matched + c.manual + c.ambiguous + c.unmatched,
    matched: c.matched,
    manual: c.manual,
    ambiguous: c.ambiguous,
    unmatched: c.unmatched,
    changed,
  };
}
