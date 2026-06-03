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

    // Inactive — PCO's literal status field. Distinct from "no
    // activity" which is computed below; we want this flag to surface
    // only the rows where someone went into PCO and explicitly marked
    // the person inactive.
    if (statusLower === "inactive" || r.inactivatedAt) {
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

// ─── Cross-org audits (for /audit/duplicates and /audit/names) ────────

export interface CrossAuditRow {
  pcoId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  status: string | null;
  inactivatedAt: string | null;
}

export type DuplicateConfidence = "high" | "low";

export interface DuplicateRow extends CrossAuditRow {
  /** Generational suffix detected on this row ("jr", "sr", "ii", "iii",
   *  "iv", "v") or null. Drives the confidence score of the group. */
  suffix: string | null;
}

export interface DuplicateGroup {
  nameKey: string;
  displayName: string;
  rows: DuplicateRow[];
  /** "high" when every row shares the same suffix (or none have one).
   *  "low" when suffixes differ — usually a parent / child pair the
   *  cluster wrongly captures (e.g. "Bob Smith" + "Bob Smith Jr"). */
  confidence: DuplicateConfidence;
}

const SUFFIX_RE = /[,\s]+(jr|sr|ii|iii|iv|v)\.?\s*$/i;

/** Strip a trailing generational suffix from a full name. Returns the
 *  cleaned name + the suffix (lowercased, no period) so the caller can
 *  use the cleaned form for keying and the suffix for scoring. */
function splitGenerationalSuffix(fullName: string): {
  core: string;
  suffix: string | null;
} {
  const m = fullName.match(SUFFIX_RE);
  if (m && m.index !== undefined) {
    const suffix = m[1].toLowerCase();
    const core = fullName.slice(0, m.index).replace(/[,\s]+$/, "").trim();
    return { core: core || fullName, suffix };
  }
  return { core: fullName, suffix: null };
}

/** Find every name that appears more than once across the whole org.
 *  Key = lowercased "first last" with generational suffixes stripped,
 *  so "Bob Smith" and "Bob Smith Jr" cluster together. The suffix
 *  mismatch then downgrades the cluster's confidence so the audit can
 *  highlight parent/child false positives. */
export function findDuplicatesAcrossOrg(orgId: number): DuplicateGroup[] {
  const rows = loadAllPeopleForAudit(orgId);
  const byKey = new Map<
    string,
    { displayName: string; rows: DuplicateRow[] }
  >();
  for (const r of rows) {
    if (!r._first || !r._last) continue;
    const full = `${r._first} ${r._last}`.trim();
    const { core, suffix } = splitGenerationalSuffix(full);
    const key = core.toLowerCase();
    if (!key) continue;
    const entry = byKey.get(key) ?? { displayName: core, rows: [] };
    entry.rows.push({ ...toCross(r), suffix });
    byKey.set(key, entry);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, entry] of byKey.entries()) {
    if (entry.rows.length < 2) continue;
    const suffixes = new Set(entry.rows.map((r) => r.suffix));
    const confidence: DuplicateConfidence = suffixes.size > 1 ? "low" : "high";
    groups.push({
      nameKey: key,
      displayName: entry.displayName,
      rows: entry.rows,
      confidence,
    });
  }
  // High-confidence clusters first; bigger clusters within each band.
  // Within a band: biggest first, then alphabetical.
  groups.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return a.confidence === "high" ? -1 : 1;
    }
    if (a.rows.length !== b.rows.length) return b.rows.length - a.rows.length;
    return a.displayName.localeCompare(b.displayName);
  });
  return groups;
}

// ─── Materialized duplicate PAIRS (with match reasons) ────────────────

interface DupPerson {
  pcoId: string;
  first: string | null;
  last: string | null;
  birthdate: string | null;
  birthYear: number | null;
  addr: string | null;
  gender: string | null;
  inactive: boolean;
  suffix: string | null;
}

export interface DupPersonView {
  pcoId: string;
  fullName: string;
  initials: string;
  inactive: boolean;
}
export interface DuplicatePairView {
  confidence: DuplicateConfidence;
  reasons: string[];
  oneActiveOneInactive: boolean;
  a: DupPersonView;
  b: DupPersonView;
}

function normAddr(s: string | null | undefined): string | null {
  if (!s) return null;
  const n = s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n || null;
}

function loadDupPeople(orgId: number): DupPerson[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT pco_id, enc_pii, gender, status, inactivated_at, birth_year
         FROM pco_people
        WHERE org_id = ?
          AND (membership_type IS NULL
               OR (lower(membership_type) NOT LIKE '%system use%'
                   AND lower(membership_type) NOT LIKE '%do not delete%'))`,
    )
    .all(orgId) as Array<{
    pco_id: string;
    enc_pii: string | null;
    gender: string | null;
    status: string | null;
    inactivated_at: string | null;
    birth_year: number | null;
  }>;
  return rows.map((r) => {
    const pii = r.enc_pii ? decryptJson<PIIBlob>(r.enc_pii) : null;
    const bd = pii?.birthdate?.trim() || null;
    const inactive =
      (r.status ?? "").toLowerCase() === "inactive" || !!r.inactivated_at;
    return {
      pcoId: r.pco_id,
      first: pii?.first_name?.trim() ?? null,
      last: pii?.last_name?.trim() ?? null,
      birthdate: bd,
      birthYear: r.birth_year ?? (bd ? Number(bd.slice(0, 4)) || null : null),
      addr: normAddr(pii?.address),
      gender: r.gender,
      inactive,
      suffix: null,
    };
  });
}

function loadEmailHashes(orgId: number): Map<string, Set<string>> {
  const rows = getDb()
    .prepare(
      `SELECT person_id, email_hash FROM pco_person_emails WHERE org_id = ?`,
    )
    .all(orgId) as Array<{ person_id: string; email_hash: string }>;
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    let s = m.get(r.person_id);
    if (!s) {
      s = new Set();
      m.set(r.person_id, s);
    }
    s.add(r.email_hash);
  }
  return m;
}

/** Score one same-name pair: build the human reasons that explain why
 *  this is (or isn't) the same person, and a high/low confidence. Strong
 *  "different person" signals (suffix mismatch, different birthdate or
 *  gender) force low and flag the likely parent/child / household case. */
function scorePair(
  a: DupPerson,
  b: DupPerson,
  emails: Map<string, Set<string>>,
): { score: number; reasons: string[]; confidence: DuplicateConfidence } {
  const reasons: string[] = [];
  let score = 0;
  let disqualified = false;

  const ea = emails.get(a.pcoId);
  const eb = emails.get(b.pcoId);
  const emailMatch = !!ea && !!eb && [...ea].some((h) => eb.has(h));
  if (emailMatch) {
    reasons.push("Shares an email address");
    score += 5;
  }

  let sameBirthdate = false;
  if (a.birthdate && b.birthdate) {
    if (a.birthdate === b.birthdate) {
      reasons.push(`Same birthdate (${a.birthdate})`);
      score += 4;
      sameBirthdate = true;
    } else {
      reasons.push(
        `Different birthdates (${a.birthdate} vs ${b.birthdate}) — likely different people`,
      );
      score -= 4;
      disqualified = true;
    }
  } else if (a.birthYear && b.birthYear) {
    if (a.birthYear === b.birthYear) {
      reasons.push(`Same birth year (${a.birthYear})`);
      score += 2;
    } else {
      reasons.push(`Different birth years (${a.birthYear} vs ${b.birthYear})`);
      score -= 3;
      disqualified = true;
    }
  }

  if (a.gender && b.gender && a.gender.toLowerCase() !== b.gender.toLowerCase()) {
    reasons.push("Different gender on record — likely different people");
    score -= 3;
    disqualified = true;
  }

  if (a.addr && b.addr && a.addr === b.addr) {
    reasons.push("Same home address");
    score += 1;
  }

  const sa = a.suffix ?? "";
  const sb = b.suffix ?? "";
  if (sa !== sb) {
    const suf = (a.suffix || b.suffix || "").toUpperCase();
    reasons.push(
      `Different generational suffix (${suf}) — likely a parent / child in the same household`,
    );
    score -= 5;
    disqualified = true;
  }

  if (a.inactive !== b.inactive) {
    reasons.push(
      "One record active, one inactive — possibly the same person returning",
    );
  }

  if (reasons.length === 0) reasons.push("Same first and last name");

  const confidence: DuplicateConfidence =
    !disqualified && (emailMatch || sameBirthdate || score >= 4)
      ? "high"
      : "low";
  return { score, reasons, confidence };
}

/** Rebuild the duplicate_pairs cache for one org. Pairs every two people
 *  who share a suffix-stripped name; drops inactive↔inactive pairs (we
 *  only act on active↔active dupes and active↔inactive "returning"
 *  cases). Called from the dashboard refresh and lazily on first view. */
export function rebuildDuplicatePairs(orgId: number): void {
  const db = getDb();
  const people = loadDupPeople(orgId);
  const emails = loadEmailHashes(orgId);

  const byKey = new Map<string, DupPerson[]>();
  for (const p of people) {
    if (!p.first || !p.last) continue;
    const { core, suffix } = splitGenerationalSuffix(`${p.first} ${p.last}`.trim());
    p.suffix = suffix;
    const key = core.toLowerCase();
    if (!key) continue;
    const arr = byKey.get(key);
    if (arr) arr.push(p);
    else byKey.set(key, [p]);
  }

  const out: Array<{
    a: string;
    b: string;
    key: string;
    confidence: DuplicateConfidence;
    score: number;
    reasons: string[];
    oai: number;
  }> = [];
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        if (a.inactive && b.inactive) continue; // not interesting
        const { score, reasons, confidence } = scorePair(a, b, emails);
        out.push({
          a: a.pcoId,
          b: b.pcoId,
          key,
          confidence,
          score,
          reasons,
          oai: a.inactive !== b.inactive ? 1 : 0,
        });
      }
    }
  }

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM duplicate_pairs WHERE org_id = ?`).run(orgId);
    const ins = db.prepare(
      `INSERT OR REPLACE INTO duplicate_pairs
         (org_id, person_a, person_b, name_key, confidence, score, reasons,
          one_active_one_inactive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of out) {
      ins.run(orgId, p.a, p.b, p.key, p.confidence, p.score, JSON.stringify(p.reasons), p.oai);
    }
    db.prepare(
      `INSERT OR REPLACE INTO duplicate_pairs_meta (org_id, built_at)
       VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    ).run(orgId);
  });
  tx();
}

/** Build the cache on first view if it's never run for this org. */
export function ensureDuplicatePairs(orgId: number): void {
  const built = getDb()
    .prepare(`SELECT 1 FROM duplicate_pairs_meta WHERE org_id = ?`)
    .get(orgId);
  if (!built) rebuildDuplicatePairs(orgId);
}

/** Read materialized duplicate pairs, decrypting names only for the
 *  people that appear in a pair. */
export function listDuplicatePairs(
  orgId: number,
  confidence?: DuplicateConfidence,
): DuplicatePairView[] {
  ensureDuplicatePairs(orgId);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT person_a, person_b, confidence, reasons, one_active_one_inactive
         FROM duplicate_pairs
        WHERE org_id = ?${confidence ? " AND confidence = ?" : ""}
        ORDER BY (confidence = 'high') DESC, score DESC`,
    )
    .all(...(confidence ? [orgId, confidence] : [orgId])) as Array<{
    person_a: string;
    person_b: string;
    confidence: DuplicateConfidence;
    reasons: string;
    one_active_one_inactive: number;
  }>;
  if (rows.length === 0) return [];

  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.person_a);
    ids.add(r.person_b);
  }
  const idList = [...ids];
  const ph = idList.map(() => "?").join(",");
  const peopleRows = db
    .prepare(
      `SELECT pco_id, enc_pii, status, inactivated_at
         FROM pco_people WHERE org_id = ? AND pco_id IN (${ph})`,
    )
    .all(orgId, ...idList) as Array<{
    pco_id: string;
    enc_pii: string | null;
    status: string | null;
    inactivated_at: string | null;
  }>;
  const view = new Map<string, DupPersonView>();
  for (const r of peopleRows) {
    const pii = r.enc_pii ? decryptJson<PIIBlob>(r.enc_pii) : null;
    const first = pii?.first_name?.trim() ?? null;
    const last = pii?.last_name?.trim() ?? null;
    view.set(r.pco_id, {
      pcoId: r.pco_id,
      fullName:
        [first, last].filter(Boolean).join(" ") || `(unknown #${r.pco_id})`,
      initials: ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase() || "??",
      inactive:
        (r.status ?? "").toLowerCase() === "inactive" || !!r.inactivated_at,
    });
  }

  const out: DuplicatePairView[] = [];
  for (const r of rows) {
    const a = view.get(r.person_a);
    const b = view.get(r.person_b);
    if (!a || !b) continue;
    out.push({
      confidence: r.confidence,
      reasons: JSON.parse(r.reasons) as string[],
      oneActiveOneInactive: r.one_active_one_inactive === 1,
      a,
      b,
    });
  }
  return out;
}

export type NameFlag = "junk-name" | "weird-name";

export interface NameIssueRow extends CrossAuditRow {
  flags: NameFlag[];
}

/** Surface every row whose name looks suspicious — junk patterns
 *  (leading non-letter, all punctuation) or weird shapes (digits,
 *  single-letter, repeated chars). Cross-org, so we catch admin /
 *  staff / inactive accounts with bad data too. */
/** PCO placeholder accounts (e.g. membership type "SYSTEM USE - Do Not
 *  Delete") aren't real people — skip them in audits. */
function isSystemUseType(t: string | null): boolean {
  return !!t && /system use|do not delete/i.test(t);
}

export function findNameIssuesAcrossOrg(orgId: number): NameIssueRow[] {
  const rows = loadAllPeopleForAudit(orgId);
  const out: NameIssueRow[] = [];
  for (const r of rows) {
    if (isSystemUseType(r.membershipType)) continue;
    const flags = nameFlagsFor(r._first, r._last);
    if (flags.length === 0) continue;
    out.push({ ...toCross(r), flags });
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}

/** Compute name-only flags. Junk = empty/no letters/leading non-letter.
 *  Weird = has digits, very short components, or 4+ repeated characters. */
function nameFlagsFor(first: string | null, last: string | null): NameFlag[] {
  const flags: NameFlag[] = [];
  if (!first && !last) {
    flags.push("junk-name");
    return flags;
  }
  if (isJunkNameLocal(first) || isJunkNameLocal(last)) {
    flags.push("junk-name");
    return flags;
  }
  const combo = `${first ?? ""}${last ?? ""}`;
  if (
    /\d/.test(combo) ||
    (first && first.length <= 1) ||
    (last && last.length <= 1) ||
    /(.)\1{3,}/i.test(combo)
  ) {
    flags.push("weird-name");
  }
  return flags;
}

interface AuditScanRow {
  pcoId: string;
  membershipType: string | null;
  status: string | null;
  inactivatedAt: string | null;
  _first: string | null;
  _last: string | null;
}

/** Single decrypt pass over the entire pco_people table. Used by both
 *  cross-org audits so we never decrypt the same enc_pii twice. */
function loadAllPeopleForAudit(orgId: number): AuditScanRow[] {
  const db = getDb();
  const rawRows = db
    .prepare(
      `SELECT pco_id, enc_pii, membership_type, status, inactivated_at
         FROM pco_people
        WHERE org_id = ?`,
    )
    .all(orgId) as Array<{
    pco_id: string;
    enc_pii: string | null;
    membership_type: string | null;
    status: string | null;
    inactivated_at: string | null;
  }>;
  return rawRows.map((r) => {
    const pii = r.enc_pii ? decryptJson<PIIBlob>(r.enc_pii) : null;
    return {
      pcoId: r.pco_id,
      membershipType: r.membership_type,
      status: r.status,
      inactivatedAt: r.inactivated_at,
      _first: pii?.first_name?.trim() ?? null,
      _last: pii?.last_name?.trim() ?? null,
    };
  });
}

function toCross(r: AuditScanRow): CrossAuditRow {
  const fullName =
    [r._first, r._last].filter(Boolean).join(" ") || `(unknown #${r.pcoId})`;
  const initials =
    ((r._first?.[0] ?? "") + (r._last?.[0] ?? "")).toUpperCase() || "??";
  return {
    pcoId: r.pcoId,
    fullName,
    initials,
    membershipType: r.membershipType,
    status: r.status,
    inactivatedAt: r.inactivatedAt,
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
