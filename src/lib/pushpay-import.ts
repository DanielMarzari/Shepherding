import "server-only";
import { getDb } from "./db";
import { decryptJson, encryptJson, hmac } from "./encryption";
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
  name: Map<string, string[]>;
  email: Map<string, string[]>;
  phone: Map<string, string[]>;
  /** pco_ids that are NOT inactive (per person_activity) — used to pick the
   *  live record when a name matches an active person + old inactive dupes. */
  active: Set<string>;
}

/** Build the name / email / phone → person-id indexes once (decrypts every
 *  person's name a single time), plus the active-person set. Shared by import
 *  and re-match. */
function buildMatchIndexes(orgId: number): MatchIndexes {
  const db = getDb();
  const name = new Map<string, string[]>();
  for (const p of db.prepare(`SELECT pco_id, first_name, last_name, enc_pii FROM pco_people WHERE org_id = ?`).all(orgId) as Array<{ pco_id: string; first_name: string | null; last_name: string | null; enc_pii: string | null }>) {
    let f = p.first_name, l = p.last_name;
    if (f == null && l == null && p.enc_pii) { const pii = decryptJson<PII>(p.enc_pii); f = pii?.first_name ?? null; l = pii?.last_name ?? null; }
    const nn = normName(f ?? "", l ?? "");
    if (nn) (name.get(nn) ?? name.set(nn, []).get(nn)!).push(p.pco_id);
  }
  const email = new Map<string, string[]>();
  for (const e of db.prepare(`SELECT email_hash, person_id FROM pco_person_emails WHERE org_id = ?`).all(orgId) as Array<{ email_hash: string; person_id: string }>) {
    (email.get(e.email_hash) ?? email.set(e.email_hash, []).get(e.email_hash)!).push(e.person_id);
  }
  const phone = new Map<string, string[]>();
  for (const ph of db.prepare(`SELECT phone_hash, person_id FROM pco_person_phones WHERE org_id = ?`).all(orgId) as Array<{ phone_hash: string; person_id: string }>) {
    (phone.get(ph.phone_hash) ?? phone.set(ph.phone_hash, []).get(ph.phone_hash)!).push(ph.person_id);
  }
  const active = new Set<string>(
    (db.prepare(`SELECT person_id FROM person_activity WHERE org_id = ? AND classification <> 'inactive'`).all(orgId) as Array<{ person_id: string }>).map((r) => r.person_id),
  );
  return { name, email, phone, active };
}

/** Decide who a donor matches from its normalized name + email/phone hashes.
 *  The person matching the MOST signals wins — all three (name + email +
 *  phone) beats two, which beats one. Inactive is NOT disqualifying: many
 *  donors are giver-only records with no other activity. Active is used only
 *  to break a tie between people who match equally well; a real tie is left
 *  ambiguous for manual reconciliation. */
function decideMatch(
  nn: string,
  eh: string | null,
  phh: string | null,
  ix: MatchIndexes,
): { personId: string | null; status: string; candidates: string[] | null } {
  const nm = nn ? ix.name.get(nn) ?? [] : [];
  const em = eh ? ix.email.get(eh) ?? [] : [];
  const ph = phh ? ix.phone.get(phh) ?? [] : [];
  const votes = new Map<string, number>();
  for (const set of [new Set(nm), new Set(em), new Set(ph)]) {
    for (const id of set) votes.set(id, (votes.get(id) ?? 0) + 1);
  }
  if (votes.size === 0) return { personId: null, status: "unmatched", candidates: null };

  // Strength of evidence decides: the person matching the MOST of
  // (name, email, phone) wins. Someone matching all three is the same person
  // even if PCO marks them inactive — plenty of donors are giver-only records
  // with no other activity to make them "active". Active is only a tiebreaker
  // when two people match equally well, never a gate on matching at all.
  const max = Math.max(...votes.values());
  const top = [...votes].filter(([, c]) => c === max).map(([id]) => id);
  if (top.length === 1) return { personId: top[0], status: "matched", candidates: null };

  const act = top.filter((id) => ix.active.has(id));
  if (act.length === 1) return { personId: act[0], status: "matched", candidates: null };
  return { personId: null, status: "ambiguous", candidates: top };
}

/** Parse the CSV, match every donor to a person, and replace the stored set. */
export function importPushpay(orgId: number, fileName: string, csvText: string): PushpayImportResult {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) return { total: 0, matched: 0, ambiguous: 0, unmatched: 0 };
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
    const nn = normName(first, last);
    const eh = email ? hmac(email.toLowerCase()) : null;
    const np = normPhone(phone);
    const phh = np ? hmac(np) : null;
    const dec = decideMatch(nn, eh, phh, ix);
    return {
      key: String(i),
      enc: encryptJson({ firstName: first, lastName: last, email, phone } as DonorPII),
      nameHash: nn ? hmac(nn) : null, emailHash: eh,
      stage: (r[iStage] ?? "").trim() || null, channel: (r[iChan] ?? "").trim() || null,
      date: parseDate(r[iDate] ?? ""), fund: (r[iFund] ?? "").trim() || null,
      firstDate: iFirst >= 0 ? parseDate(r[iFirst] ?? "") : null,
      personId: dec.personId, status: dec.status, candidates: dec.candidates,
    };
  });

  const run = db.transaction(() => {
    db.prepare(`DELETE FROM pushpay_donors WHERE org_id = ?`).run(orgId);
    const ins = db.prepare(`INSERT INTO pushpay_donors
      (org_id, donor_key, enc, name_hash, email_hash, donor_stage, giving_channel, last_gift_date, last_gift_fund, first_gift_date, person_id, match_status, candidate_ids)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const d of donors) ins.run(orgId, d.key, d.enc, d.nameHash, d.emailHash, d.stage, d.channel, d.date, d.fund, d.firstDate, d.personId, d.status, d.candidates ? JSON.stringify(d.candidates) : null);
    const counts: PushpayImportResult = {
      total: donors.length,
      matched: donors.filter((d) => d.status === "matched").length,
      ambiguous: donors.filter((d) => d.status === "ambiguous").length,
      unmatched: donors.filter((d) => d.status === "unmatched").length,
    };
    db.prepare(`INSERT INTO pushpay_import (org_id, file_name, total, matched, ambiguous, unmatched, imported_at)
      VALUES (?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(org_id) DO UPDATE SET file_name=excluded.file_name, total=excluded.total, matched=excluded.matched, ambiguous=excluded.ambiguous, unmatched=excluded.unmatched, imported_at=excluded.imported_at`)
      .run(orgId, fileName, counts.total, counts.matched, counts.ambiguous, counts.unmatched);
    return counts;
  });
  return run();
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
      const nn = normName(d?.firstName ?? "", d?.lastName ?? "");
      const eh = d?.email ? hmac(d.email.trim().toLowerCase()) : null;
      const np = normPhone(d?.phone ?? null);
      const phh = np ? hmac(np) : null;
      const dec = decideMatch(nn, eh, phh, ix);
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

export interface PushpayImportMeta { fileName: string | null; total: number; matched: number; ambiguous: number; unmatched: number; importedAt: string | null }

export function getPushpayImport(orgId: number): PushpayImportMeta | null {
  const r = getDb().prepare(`SELECT file_name, total, matched, ambiguous, unmatched, imported_at FROM pushpay_import WHERE org_id = ?`).get(orgId) as
    | { file_name: string | null; total: number; matched: number; ambiguous: number; unmatched: number; imported_at: string } | undefined;
  return r ? { fileName: r.file_name, total: r.total, matched: r.matched, ambiguous: r.ambiguous, unmatched: r.unmatched, importedAt: r.imported_at } : null;
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

const donorName = (enc: string): { fullName: string; email: string; phone: string } => {
  const p = decryptJson<DonorPII>(enc);
  return { fullName: [p?.firstName, p?.lastName].filter(Boolean).join(" ") || "—", email: p?.email ?? "", phone: p?.phone ?? "" };
};

/** Decrypted person names, for resolving ambiguous candidates. */
function personNames(orgId: number, ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  for (const r of getDb().prepare(`SELECT pco_id, enc_pii FROM pco_people WHERE org_id = ? AND pco_id IN (${ph})`).all(orgId, ...ids) as Array<{ pco_id: string; enc_pii: string | null }>) {
    const pii = r.enc_pii ? decryptJson<PII>(r.enc_pii) : null;
    out.set(r.pco_id, [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") || `#${r.pco_id}`);
  }
  return out;
}

/** Donors in a match state (for the audit reconciliation UI). */
export function listDonorsByStatus(orgId: number, status: string, limit = 500): DonorRow[] {
  const rows = getDb().prepare(
    `SELECT donor_key, enc, donor_stage, giving_channel, last_gift_date, last_gift_fund, match_status, person_id, candidate_ids
       FROM pushpay_donors WHERE org_id = ? AND match_status = ? ORDER BY donor_key LIMIT ?`,
  ).all(orgId, status, limit) as Array<{ donor_key: string; enc: string; donor_stage: string | null; giving_channel: string | null; last_gift_date: string | null; last_gift_fund: string | null; match_status: string; person_id: string | null; candidate_ids: string | null }>;
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
    return { donorKey: r.donor_key, ...n, stage: r.donor_stage, channel: r.giving_channel, lastGiftDate: r.last_gift_date, fund: r.last_gift_fund, status: r.match_status, personId: r.person_id, assignedName: r.person_id ? names.get(r.person_id) ?? `#${r.person_id}` : null, candidates: cand };
  });
}

export interface MatchedDonor { pcoId: string; name: string; stage: string | null; fund: string | null; channel: string | null; lastGiftDate: string | null }

/** Matched donors joined to their person (decrypted name + pco id for links).
 *  Optional stage filter (e.g. "Lapsed Donor"). Used by builder sources. */
export function listMatchedDonors(orgId: number, opts: { stage?: string; limit?: number } = {}): MatchedDonor[] {
  const args: unknown[] = [orgId];
  let where = `WHERE d.org_id = ? AND d.person_id IS NOT NULL`;
  if (opts.stage) { where += ` AND d.donor_stage = ?`; args.push(opts.stage); }
  args.push(opts.limit ?? 1000);
  const rows = getDb().prepare(
    `SELECT d.person_id AS pco, d.donor_stage AS stage, d.last_gift_fund AS fund, d.giving_channel AS channel, d.last_gift_date AS lg, p.enc_pii AS enc
       FROM pushpay_donors d JOIN pco_people p ON p.org_id = d.org_id AND p.pco_id = d.person_id
       ${where} ORDER BY d.last_gift_date DESC LIMIT ?`,
  ).all(...args) as Array<{ pco: string; stage: string | null; fund: string | null; channel: string | null; lg: string | null; enc: string | null }>;
  return rows.map((r) => {
    const pii = r.enc ? decryptJson<PII>(r.enc) : null;
    return { pcoId: r.pco, name: [pii?.first_name, pii?.last_name].filter(Boolean).join(" ") || `#${r.pco}`, stage: r.stage, fund: r.fund, channel: r.channel, lastGiftDate: r.lg };
  });
}

/** Distinct people tied to at least one imported gift — the "has given"
 *  population that fills the Give next-step lane. */
export function countGivers(orgId: number): number {
  const r = getDb()
    .prepare(`SELECT COUNT(DISTINCT person_id) AS n FROM pushpay_donors WHERE org_id = ? AND person_id IS NOT NULL`)
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
