// One-time helper: assign a roster of people (by display name) to a
// single shepherd's CARE roster (care_assignments), matching the exact
// eligibility the /care-map uses: classification = 'active', adult,
// not already assigned, excluded-membership-aware.
//
// SAFE BY DEFAULT — prints a dry-run report and changes nothing.
// Add --apply to actually insert the confident (exact-name) matches.
//
// Usage (run on the server, from the app root where node_modules lives):
//   ENCRYPTION_KEY=... DATABASE_PATH=/var/www/apps/shepherdly/shepherding.db \
//     node scripts/assign-roster.mjs            # dry run
//   ENCRYPTION_KEY=... DATABASE_PATH=... node scripts/assign-roster.mjs --apply
//
// Optional env:
//   SHEPHERD_PCO_ID=...  # override; otherwise resolved from SHEPHERD_NAME
//   SHEPHERD_NAME="Daniel Marzari"
//   ORG_ID=...           # required only if the DB has more than one org
//   INCLUDE_FUZZY=1      # also apply single-candidate nickname/last-name matches

import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const APPLY = process.argv.includes("--apply");
const INCLUDE_FUZZY = process.env.INCLUDE_FUZZY === "1";
const SHEPHERD_NAME = process.env.SHEPHERD_NAME || "Daniel Marzari";
const DB_PATH = process.env.DATABASE_PATH || "./shepherding.db";

// ── The GroupMe roster ──────────────────────────────────────────────
const ROSTER = `
Addi Smith
Alison Madera
Amanda Blagbrough
Amelia Egeler
Annamaria Gallina
Asha Matthew
Ava Rosario
Becca Peters
Blake Gill
Brianna Weber
Brielle DiGiacomo
Bryce Torres
Caleb Hazler
Caleb Rudloff
Cole Hovan
Dana Gehringer
Daniel Marzari
Deja Spears
Dominick Cavallucci
Drew Collier
Gabby Kres
Hannah Daniels
Hannah Hoy
Kajanna Hylton
Isabelle Yengst
Jaydeine Casseus
Jhasnielle Casseus
Joe Hazler
Jon Warner
Jonathan Nondo
Josiah Shields
Kamryn Smith
Karabo Mwasi
Katelyn Pammer
Kevin Virgo III
Liliana Nino
Lindsay Conrad
Liz McSloy
Luke Fisher
Madeline Erk
Madeline Snyder
Madi Weber
Matt Peters
Matt Warner
Matthew Holderith
Mia Marino
Micah Schmidt
Miyeli Vazquez
Noel Ramos
Olivia Lynch
Rachel Hoy
Ronak Singh
Rosalie Holderith
Samantha Nino
Sarah Weiss
Savana Serfass
Steph Shara
Zach Messinger
`
  .trim()
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

// Common nicknames -> canonical first names, to recover fuzzy matches.
const NICK = {
  addi: ["addison", "adelaide", "adriana"],
  becca: ["rebecca", "rebekah"],
  liz: ["elizabeth"],
  beth: ["elizabeth"],
  matt: ["matthew"],
  madi: ["madison", "madeline", "madelyn"],
  gabby: ["gabrielle", "gabriella"],
  steph: ["stephanie"],
  sam: ["samantha", "samuel"],
  dom: ["dominick", "dominic"],
  drew: ["andrew"],
  joe: ["joseph"],
  jon: ["jonathan", "jonathon", "john"],
  zach: ["zachary", "zachariah"],
  mike: ["michael"],
  alex: ["alexander", "alexandra"],
  ben: ["benjamin"],
  chris: ["christopher", "christina", "christine"],
  dan: ["daniel"],
  danny: ["daniel"],
  nick: ["nicholas"],
  tom: ["thomas"],
  will: ["william"],
  kate: ["katelyn", "katherine", "kathryn"],
  katie: ["katelyn", "katherine", "kathryn"],
  savana: ["savanna", "savannah"],
};

// ── AES-256-GCM decrypt (matches src/lib/encryption.ts) ─────────────
function getKey() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY env var is required (base64, 32 bytes).");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes.");
  return buf;
}
const KEY = getKey();
function decryptJson(payload) {
  if (!payload) return null;
  try {
    const buf = Buffer.from(payload, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    d.setAuthTag(tag);
    const out = Buffer.concat([d.update(ct), d.final()]).toString("utf8");
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// ── Name normalization ──────────────────────────────────────────────
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(full) {
  return norm(full)
    .split(" ")
    .filter((t) => t && !SUFFIX.has(t));
}
function nameKey(first, last) {
  return `${norm(first)} ${norm(last)}`.trim();
}

// ── Load DB ─────────────────────────────────────────────────────────
const db = new Database(DB_PATH, { readonly: !APPLY });

// Resolve org.
const orgs = db.prepare("SELECT DISTINCT org_id FROM pco_people").all().map((r) => r.org_id);
let ORG_ID = process.env.ORG_ID ? Number(process.env.ORG_ID) : null;

// Pull everyone with their classification + assignment + minor status.
const allRows = db
  .prepare(
    `SELECT p.org_id, p.pco_id, p.enc_pii, p.is_minor, p.membership_type,
            p.status, p.inactivated_at,
            pa.classification AS classification,
            ca.shepherd_person_id AS assignedTo
       FROM pco_people p
       LEFT JOIN person_activity pa
         ON pa.org_id = p.org_id AND pa.person_id = p.pco_id
       LEFT JOIN care_assignments ca
         ON ca.org_id = p.org_id AND ca.person_id = p.pco_id`,
  )
  .all();

// excluded membership types per org
function excludedFor(orgId) {
  const row = db
    .prepare("SELECT excluded_membership_types FROM pco_sync_settings WHERE org_id = ?")
    .get(orgId);
  if (!row?.excluded_membership_types) return new Set();
  try {
    const arr = JSON.parse(row.excluded_membership_types);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

// Decrypt + index by name.
const people = [];
for (const r of allRows) {
  const pii = decryptJson(r.enc_pii) || {};
  const first = pii.first_name ?? "";
  const last = pii.last_name ?? "";
  if (!first && !last) continue;
  people.push({
    orgId: r.org_id,
    pcoId: r.pco_id,
    first,
    last,
    full: [first, last].filter(Boolean).join(" "),
    isMinor: r.is_minor === 1,
    membership: r.membership_type,
    classification: r.classification,
    assignedTo: r.assignedTo,
    pcoInactive:
      String(r.status || "").toLowerCase() === "inactive" || !!r.inactivated_at,
  });
}

// Resolve shepherd.
let SHEPHERD_PCO_ID = process.env.SHEPHERD_PCO_ID || null;
if (!SHEPHERD_PCO_ID) {
  const shepKey = norm(SHEPHERD_NAME);
  const hit = people.filter((p) => norm(p.full) === shepKey);
  if (hit.length === 1) {
    SHEPHERD_PCO_ID = hit[0].pcoId;
    if (!ORG_ID) ORG_ID = hit[0].orgId;
  } else if (hit.length > 1) {
    console.error(`Multiple people named "${SHEPHERD_NAME}". Set SHEPHERD_PCO_ID.`);
    process.exit(1);
  }
}
if (!ORG_ID) {
  if (orgs.length === 1) ORG_ID = orgs[0];
  else {
    console.error(`DB has ${orgs.length} orgs (${orgs.join(", ")}). Set ORG_ID.`);
    process.exit(1);
  }
}
if (!SHEPHERD_PCO_ID) {
  console.error(
    `Could not find shepherd "${SHEPHERD_NAME}" in org ${ORG_ID}. Set SHEPHERD_PCO_ID.`,
  );
  process.exit(1);
}

const excluded = excludedFor(ORG_ID);
const inOrg = people.filter((p) => p.orgId === ORG_ID);

// Build lookup indexes for THIS org.
const byFull = new Map(); // "first last" -> [people]
const byLast = new Map(); // "last" -> [people]
for (const p of inOrg) {
  const fk = nameKey(p.first, p.last);
  if (!byFull.has(fk)) byFull.set(fk, []);
  byFull.get(fk).push(p);
  const lk = norm(p.last);
  if (!byLast.has(lk)) byLast.set(lk, []);
  byLast.get(lk).push(p);
}

function firstNameMatches(rosterFirst, candFirst) {
  const a = norm(rosterFirst);
  const b = norm(candFirst);
  if (a === b) return true;
  if (b.startsWith(a) || a.startsWith(b)) return true; // Addi~Addison
  const exp = NICK[a] || [];
  if (exp.includes(b)) return true;
  const expB = NICK[b] || [];
  if (expB.includes(a)) return true;
  return false;
}

// Eligibility = the care-map candidate rule.
function eligibility(p) {
  if (p.pcoInactive) return "inactive (PCO)";
  if (p.isMinor) return "minor";
  if (excluded.has(p.membership)) return `excluded membership (${p.membership})`;
  if (p.assignedTo)
    return p.assignedTo === SHEPHERD_PCO_ID
      ? "already assigned to you"
      : "assigned to another shepherd";
  if (p.classification === "shepherded") return "shepherded (in a group/team)";
  if (p.classification === "present") return "present (not active)";
  if (p.classification === "active") return "ELIGIBLE";
  return `not active (${p.classification ?? "unclassified"})`;
}

// ── Match the roster ────────────────────────────────────────────────
const toAssign = []; // {roster, person} exact
const fuzzy = []; // {roster, person} single last-name+first match
const ambiguous = []; // {roster, candidates}
const ineligible = []; // {roster, person, reason}
const unmatched = [];

for (const rosterName of ROSTER) {
  if (norm(rosterName) === norm(SHEPHERD_NAME)) continue; // skip self

  const tks = tokens(rosterName);
  const rFirst = tks[0] ?? "";
  const rLast = tks.length > 1 ? tks[tks.length - 1] : "";

  // 1) exact full-name match
  const exact = (byFull.get(`${rFirst} ${rLast}`) || []).slice();
  let chosen = null;
  let isFuzzy = false;

  if (exact.length === 1) {
    chosen = exact[0];
  } else if (exact.length > 1) {
    ambiguous.push({ roster: rosterName, candidates: exact });
    continue;
  } else {
    // 2) fuzzy: same last name + nickname/startsWith first name
    const lastHits = (byLast.get(rLast) || []).filter((p) =>
      firstNameMatches(rFirst, p.first),
    );
    if (lastHits.length === 1) {
      chosen = lastHits[0];
      isFuzzy = true;
    } else if (lastHits.length > 1) {
      ambiguous.push({ roster: rosterName, candidates: lastHits });
      continue;
    } else {
      unmatched.push(rosterName);
      continue;
    }
  }

  const reason = eligibility(chosen);
  if (reason !== "ELIGIBLE") {
    ineligible.push({ roster: rosterName, person: chosen, reason });
    continue;
  }
  (isFuzzy ? fuzzy : toAssign).push({ roster: rosterName, person: chosen });
}

// ── Report ──────────────────────────────────────────────────────────
const tag = APPLY ? "APPLY" : "DRY RUN";
console.log(`\n=== Roster → care assignment (${tag}) ===`);
console.log(`Org ${ORG_ID} · shepherd ${SHEPHERD_NAME} (${SHEPHERD_PCO_ID})`);
console.log(`Roster: ${ROSTER.length} names\n`);

console.log(`EXACT MATCHES — eligible & will be assigned (${toAssign.length}):`);
for (const m of toAssign) console.log(`  ✓ ${m.roster}  →  ${m.person.full} [${m.person.pcoId}]`);

console.log(`\nFUZZY MATCHES (nickname/last-name; ${INCLUDE_FUZZY ? "WILL" : "won't"} apply unless INCLUDE_FUZZY=1) (${fuzzy.length}):`);
for (const m of fuzzy) console.log(`  ~ ${m.roster}  →  ${m.person.full} [${m.person.pcoId}]`);

console.log(`\nFOUND BUT NOT AN ACTIVE CARE CANDIDATE (${ineligible.length}):`);
for (const m of ineligible) console.log(`  · ${m.roster}  →  ${m.person.full}  — ${m.reason}`);

console.log(`\nAMBIGUOUS — multiple people match, skipped (${ambiguous.length}):`);
for (const a of ambiguous)
  console.log(`  ? ${a.roster}  →  ${a.candidates.map((c) => `${c.full}[${c.pcoId}]`).join(", ")}`);

console.log(`\nNOT FOUND in this org (${unmatched.length}):`);
for (const u of unmatched) console.log(`  ✗ ${u}`);

// ── Apply ───────────────────────────────────────────────────────────
const final = INCLUDE_FUZZY ? [...toAssign, ...fuzzy] : toAssign;
if (APPLY && final.length > 0) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO care_assignments (org_id, shepherd_person_id, person_id, note)
     VALUES (?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows) => {
    let n = 0;
    for (const m of rows) {
      const res = insert.run(ORG_ID, SHEPHERD_PCO_ID, m.person.pcoId, "GroupMe roster");
      n += res.changes;
    }
    return n;
  });
  const inserted = tx(final);
  console.log(`\nAPPLIED: inserted ${inserted} care assignment(s) to ${SHEPHERD_NAME}.`);
} else if (APPLY) {
  console.log(`\nAPPLIED: nothing to insert.`);
} else {
  console.log(`\n(DRY RUN — no changes. Re-run with --apply to assign the ${final.length} match(es) above.)`);
}

db.close();
