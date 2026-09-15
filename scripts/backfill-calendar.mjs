// One-time seed for the PCO Calendar tables (migration 0084).
//
// The recurring sync (syncCalendarAll in src/lib/pco-sync-calendar.ts) keeps a
// rolling window current — three years back, eighteen months forward. This
// reaches further back so the Facilities report can show a real multi-year
// trend, and it does the whole job in one pass instead of waiting for a
// scheduled run.
//
// Idempotent: every write is an upsert keyed on the PCO id, so re-running
// converges. Safe to interrupt and restart; already-written pages are simply
// rewritten.
//
// Run on the server with the app env loaded:
//   set -a; . /var/www/apps/shepherdly/.env.production; set +a
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db \
//     node scripts/backfill-calendar.mjs
//
// Options (env):
//   FROM=2018-01-01  earliest instance/booking start to fetch
//   TO=2029-01-01    exclusive upper bound
//   ONLY=<regex>     run only matching phases: events|resources|instances|requests|bookings
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
const orgId = Number(process.env.ORG_ID ?? 1);
const cred = db.prepare("SELECT app_id_enc, secret_enc FROM pco_credentials WHERE org_id = ?").get(orgId);
const auth = "Basic " + Buffer.from(`${dec(cred.app_id_enc)}:${dec(cred.secret_enc)}`).toString("base64");

const FROM = process.env.FROM ?? "2018-01-01";
const TO = process.env.TO ?? "2029-01-01";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
const wanted = (phase) => !ONLY || ONLY.test(phase);

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

/** Page through an endpoint, handing each page to `onPage` as it arrives.
 *  Streaming rather than collecting: bookings alone are six figures. */
async function pages(url, label, onPage) {
  let u = url;
  let n = 0;
  let rows = 0;
  const t0 = Date.now();
  while (u) {
    const j = await get(u);
    if (!j) break;
    const data = j.data ?? [];
    onPage(data, j);
    n++;
    rows += data.length;
    if (n % 25 === 0) {
      const secs = Math.round((Date.now() - t0) / 1000);
      process.stdout.write(`    ${label}: ${rows} rows, ${n} pages, ${secs}s\n`);
    }
    u = j.links?.next ? j.links.next.replace("https://api.planningcenteronline.com", "") : null;
  }
  console.log(`  ${label}: ${rows} rows in ${n} pages, ${Math.round((Date.now() - t0) / 1000)}s`);
  return rows;
}

const NULL_PERSON = "null_person";
const str = (v) => (typeof v === "string" && v !== "" ? v : null);
const int = (v) => (typeof v === "number" ? Math.trunc(v) : null);
const relId = (res, name) => {
  const rel = res.relationships?.[name]?.data;
  if (!rel || Array.isArray(rel)) return null;
  return rel.id && rel.id !== NULL_PERSON ? rel.id : null;
};

console.log(`Backfilling PCO Calendar for org ${orgId}, window ${FROM} .. ${TO}`);

// ── Events ─────────────────────────────────────────────────────────────────
if (wanted("events")) {
  const up = db.prepare(
    `INSERT INTO pco_calendar_events
       (org_id, pco_id, name, approval_status, percent_approved,
        visible_in_church_center, owner_id, pco_created_at, pco_updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       name=excluded.name, approval_status=excluded.approval_status,
       percent_approved=excluded.percent_approved,
       visible_in_church_center=excluded.visible_in_church_center,
       owner_id=excluded.owner_id, pco_created_at=excluded.pco_created_at,
       pco_updated_at=excluded.pco_updated_at, synced_at=excluded.synced_at`,
  );
  const write = db.transaction((data) => {
    for (const e of data) {
      const a = e.attributes ?? {};
      up.run(orgId, e.id, str(a.name), str(a.approval_status), int(a.percent_approved),
        a.visible_in_church_center === true ? 1 : 0, relId(e, "owner"),
        str(a.created_at), str(a.updated_at));
    }
  });
  await pages("/calendar/v2/events?per_page=100&include=owner", "events", write);
}

// ── Resources ──────────────────────────────────────────────────────────────
if (wanted("resources")) {
  const up = db.prepare(
    `INSERT INTO pco_calendar_resources
       (org_id, pco_id, name, kind, path_name, quantity, expires_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind, path_name=excluded.path_name,
       quantity=excluded.quantity, expires_at=excluded.expires_at, synced_at=excluded.synced_at`,
  );
  const write = db.transaction((data) => {
    for (const r of data) {
      const a = r.attributes ?? {};
      up.run(orgId, r.id, str(a.name), str(a.kind), str(a.path_name), int(a.quantity), str(a.expires_at));
    }
  });
  await pages("/calendar/v2/resources?per_page=100", "resources", write);
}

// ── Event instances ────────────────────────────────────────────────────────
if (wanted("instances")) {
  const up = db.prepare(
    `INSERT INTO pco_calendar_event_instances
       (org_id, pco_id, event_id, name, location, starts_at, ends_at,
        all_day, recurrence, pco_created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       event_id=excluded.event_id, name=excluded.name, location=excluded.location,
       starts_at=excluded.starts_at, ends_at=excluded.ends_at, all_day=excluded.all_day,
       recurrence=excluded.recurrence, pco_created_at=excluded.pco_created_at,
       synced_at=excluded.synced_at`,
  );
  let orphans = 0;
  const write = db.transaction((data) => {
    for (const i of data) {
      const a = i.attributes ?? {};
      const eventId = relId(i, "event");
      if (!eventId) { orphans++; continue; }
      up.run(orgId, i.id, eventId, str(a.name), str(a.location), str(a.starts_at),
        str(a.ends_at), a.all_day_event === true ? 1 : 0, str(a.recurrence), str(a.created_at));
    }
  });
  await pages(
    `/calendar/v2/event_instances?per_page=100&where[starts_at][gte]=${FROM}T00:00:00Z&where[starts_at][lt]=${TO}T00:00:00Z`,
    "event_instances", write);
  if (orphans) console.log(`    (${orphans} instances skipped: no event relationship)`);
}

// ── Resource requests ──────────────────────────────────────────────────────
if (wanted("requests")) {
  const up = db.prepare(
    `INSERT INTO pco_calendar_resource_requests
       (org_id, pco_id, event_id, resource_id, quantity, notes, approval_status,
        room_setup_id, pco_created_at, pco_updated_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       event_id=excluded.event_id, resource_id=excluded.resource_id, quantity=excluded.quantity,
       notes=excluded.notes, approval_status=excluded.approval_status,
       room_setup_id=excluded.room_setup_id, pco_created_at=excluded.pco_created_at,
       pco_updated_at=excluded.pco_updated_at, synced_at=excluded.synced_at`,
  );
  const write = db.transaction((data) => {
    for (const r of data) {
      const a = r.attributes ?? {};
      up.run(orgId, r.id, relId(r, "event"), relId(r, "resource"), int(a.quantity),
        str(a.notes), str(a.approval_status), relId(r, "room_setup"),
        str(a.created_at), str(a.updated_at));
    }
  });
  await pages("/calendar/v2/event_resource_requests?per_page=100&order=-updated_at",
    "event_resource_requests", write);
}

// ── Resource bookings ──────────────────────────────────────────────────────
if (wanted("bookings")) {
  const up = db.prepare(
    `INSERT INTO pco_calendar_resource_bookings
       (org_id, pco_id, event_id, event_instance_id, resource_id,
        starts_at, ends_at, quantity, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(org_id, pco_id) DO UPDATE SET
       event_id=excluded.event_id, event_instance_id=excluded.event_instance_id,
       resource_id=excluded.resource_id, starts_at=excluded.starts_at,
       ends_at=excluded.ends_at, quantity=excluded.quantity, synced_at=excluded.synced_at`,
  );
  const write = db.transaction((data) => {
    for (const b of data) {
      const a = b.attributes ?? {};
      up.run(orgId, b.id, relId(b, "event"), relId(b, "event_instance"),
        relId(b, "resource"), str(a.starts_at), str(a.ends_at), int(a.quantity));
    }
  });
  await pages(
    `/calendar/v2/resource_bookings?per_page=100&where[starts_at][gte]=${FROM}T00:00:00Z&where[starts_at][lt]=${TO}T00:00:00Z`,
    "resource_bookings", write);
}

const n = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE org_id = ?`).get(orgId).c;
console.log("\nHeld now:");
for (const t of ["pco_calendar_events", "pco_calendar_event_instances", "pco_calendar_resources",
  "pco_calendar_resource_requests", "pco_calendar_resource_bookings"]) {
  console.log(`  ${t.padEnd(36)} ${n(t)}`);
}
const owned = db.prepare(
  `SELECT COUNT(*) c FROM pco_calendar_events WHERE org_id = ? AND owner_id IS NOT NULL`).get(orgId).c;
console.log(`  events with an owner                 ${owned}`);
