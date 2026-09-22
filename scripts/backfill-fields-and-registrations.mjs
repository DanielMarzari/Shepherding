// One-time seed for pco_person_fields and the Registrations tables.
//
// Both are new in migration 0082 and are populated by the nightly sync from
// then on. This fills them now, without waiting for a scheduled run — useful
// because the host's sync cron is not currently firing (the last automatic run
// was 2026-07-28; everything since has been triggered by hand).
//
// Mirrors syncPersonFields in src/lib/pco-sync.ts and syncRegistrationsAll in
// src/lib/pco-sync-registrations.ts. Idempotent: replaces each field
// definition's rows and each signup's attendee list wholesale, so re-running
// converges rather than duplicating.
//
// Run on the server with the app env loaded:
//   set -a; . /var/www/apps/shepherdly/.env.production; set +a
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db \
//     node scripts/backfill-fields-and-registrations.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const Database = require(process.env.BETTER_SQLITE3 ?? "better-sqlite3");
const db = new Database(process.env.DATABASE_PATH);
db.pragma("busy_timeout = 10000");

const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
const dec = (p) => {
  const b = Buffer.from(p, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
};
const orgId = 1;
const cred = db.prepare("SELECT app_id_enc, secret_enc FROM pco_credentials WHERE org_id = ?").get(orgId);
const auth = "Basic " + Buffer.from(`${dec(cred.app_id_enc)}:${dec(cred.secret_enc)}`).toString("base64");

let sleepUntil = 0;
async function get(url, attempt = 0) {
  const wait = sleepUntil - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  let res;
  try {
    res = await fetch("https://api.planningcenteronline.com" + url, { headers: { Authorization: auth } });
  } catch (e) {
    if (attempt >= 3) throw e;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return get(url, attempt + 1);
  }
  const limit = Number(res.headers.get("x-pco-api-request-rate-limit") ?? 100);
  const count = Number(res.headers.get("x-pco-api-request-rate-count") ?? 0);
  const period = Number(res.headers.get("x-pco-api-request-rate-period") ?? 20);
  if (count >= limit - 5) sleepUntil = Date.now() + period * 1000;
  if (res.status === 429) {
    sleepUntil = Date.now() + Number(res.headers.get("retry-after") ?? period) * 1000;
    if (attempt >= 5) throw new Error("429: " + url);
    return get(url, attempt + 1);
  }
  if (!res.ok) {
    if (res.status === 404) return null;
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return get(url, attempt + 1);
  }
  return res.json();
}
async function all(url) {
  const out = [];
  let u = url;
  while (u) {
    const j = await get(u);
    if (!j) break;
    out.push(...(j.data ?? []));
    u = j.links?.next ? j.links.next.replace("https://api.planningcenteronline.com", "") : null;
  }
  return out;
}

const toIso = (raw) => {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
};

// ── 1. Allowlisted person custom fields ────────────────────────────────
const ALLOW = new Set(["Baptism"]);
const defs = (await all("/people/v2/field_definitions?per_page=100")).filter(
  (d) => !d.attributes?.deleted_at && ALLOW.has(d.attributes?.name),
);
const insField = db.prepare(
  `INSERT INTO pco_person_fields (org_id, person_id, field_id, field_name, value, value_on, synced_at)
   VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   ON CONFLICT(org_id, person_id, field_id) DO UPDATE SET
     field_name=excluded.field_name, value=excluded.value,
     value_on=excluded.value_on, synced_at=excluded.synced_at`,
);
for (const def of defs) {
  const rows = (await all(`/people/v2/field_data?where[field_definition_id]=${def.id}&per_page=100`))
    .map((fd) => ({ pid: fd.relationships?.customizable?.data?.id, v: fd.attributes?.value ?? null }))
    .filter((r) => r.pid);
  db.transaction(() => {
    db.prepare("DELETE FROM pco_person_fields WHERE org_id = ? AND field_id = ?").run(orgId, def.id);
    for (const r of rows) insField.run(orgId, r.pid, def.id, def.attributes.name, r.v, toIso(r.v));
  })();
  const dated = rows.filter((r) => toIso(r.v)).length;
  console.log(`field "${def.attributes.name}": ${rows.length} rows, ${dated} parsed to a date`);
}

// ── 2. Registrations signups + attendees ───────────────────────────────
const signups = await all("/registrations/v2/signups?per_page=100");
const insSignup = db.prepare(
  `INSERT INTO pco_registration_signups (org_id, pco_id, name, is_archived, open, pco_created_at, pco_updated_at, synced_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   ON CONFLICT(org_id, pco_id) DO UPDATE SET
     name=excluded.name, is_archived=excluded.is_archived, open=excluded.open,
     pco_created_at=excluded.pco_created_at, pco_updated_at=excluded.pco_updated_at,
     synced_at=excluded.synced_at`,
);
db.transaction(() => {
  for (const s of signups) {
    const a = s.attributes ?? {};
    insSignup.run(orgId, s.id, a.name ?? null, a.archived === true ? 1 : 0, a.open === true ? 1 : 0,
      a.created_at ?? null, a.updated_at ?? null);
  }
})();
console.log(`signups: ${signups.length}`);

// Attendees are one request per signup. ONLY= limits it to signups whose name
// matches, so a targeted re-seed does not cost 900+ calls.
const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
const targets = only ? signups.filter((s) => only.test(s.attributes?.name ?? "")) : signups;
console.log(`fetching attendees for ${targets.length} signups${only ? ` matching /${process.env.ONLY}/i` : ""}`);
const insAtt = db.prepare(
  `INSERT INTO pco_registration_attendees (org_id, pco_id, signup_id, person_id, canceled, waitlisted, pco_created_at, synced_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   ON CONFLICT(org_id, pco_id) DO UPDATE SET
     signup_id=excluded.signup_id, person_id=excluded.person_id, canceled=excluded.canceled,
     waitlisted=excluded.waitlisted, pco_created_at=excluded.pco_created_at, synced_at=excluded.synced_at`,
);
let done = 0, rows = 0;
for (const s of targets) {
  const att = await all(`/registrations/v2/signups/${s.id}/attendees?per_page=100&include=person`);
  db.transaction(() => {
    db.prepare("DELETE FROM pco_registration_attendees WHERE org_id = ? AND signup_id = ?").run(orgId, s.id);
    for (const a of att) {
      insAtt.run(orgId, a.id, s.id, a.relationships?.person?.data?.id ?? null,
        a.attributes?.canceled === true ? 1 : 0, a.attributes?.waitlisted === true ? 1 : 0,
        a.attributes?.created_at ?? null);
    }
  })();
  rows += att.length;
  if (++done % 50 === 0) console.log(`  ${done}/${targets.length} signups, ${rows} attendees`);
}
console.log(`\nattendees: ${rows} across ${done} signups`);
console.log("person_fields:", db.prepare("SELECT COUNT(*) n FROM pco_person_fields WHERE org_id=?").get(orgId).n);
console.log("signups:", db.prepare("SELECT COUNT(*) n FROM pco_registration_signups WHERE org_id=?").get(orgId).n);
console.log("attendees:", db.prepare("SELECT COUNT(*) n FROM pco_registration_attendees WHERE org_id=?").get(orgId).n);
