// One-time pull of PCO Check-Ins headcounts, then fold them into the
// attendance tables. The recurring sync does both from now on; this fills the
// history without waiting for a scheduled run.
//
// Run on the server with the app env loaded:
//   set -a; . /var/www/apps/shepherdly/.env.production; set +a
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db \
//     node scripts/backfill-headcounts.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const Database = require(process.env.BETTER_SQLITE3 ?? "better-sqlite3");
const db = new Database(process.env.DATABASE_PATH);
db.pragma("busy_timeout = 15000");
const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
const dec = (p) => { const b = Buffer.from(p, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0,12));
  d.setAuthTag(b.subarray(12,28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); };
const orgId = Number(process.env.ORG_ID ?? 1);
const cred = db.prepare("SELECT app_id_enc, secret_enc FROM pco_credentials WHERE org_id = ?").get(orgId);
const auth = "Basic " + Buffer.from(`${dec(cred.app_id_enc)}:${dec(cred.secret_enc)}`).toString("base64");

let sleepUntil = 0;
async function get(url, attempt = 0) {
  const w = sleepUntil - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w));
  let res;
  try { res = await fetch("https://api.planningcenteronline.com" + url, { headers: { Authorization: auth } }); }
  catch (e) { if (attempt >= 3) throw e; await new Promise(r=>setTimeout(r,2000*(attempt+1))); return get(url, attempt+1); }
  const lim = Number(res.headers.get("x-pco-api-request-rate-limit") ?? 100);
  const cnt = Number(res.headers.get("x-pco-api-request-rate-count") ?? 0);
  const per = Number(res.headers.get("x-pco-api-request-rate-period") ?? 20);
  if (cnt >= lim - 5) sleepUntil = Date.now() + per * 1000;
  if (res.status === 429) { sleepUntil = Date.now() + Number(res.headers.get("retry-after") ?? per)*1000;
    if (attempt >= 5) throw new Error("429 " + url); return get(url, attempt+1); }
  if (!res.ok) { if (res.status === 404) return null;
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise(r=>setTimeout(r,2000*(attempt+1))); return get(url, attempt+1); }
  return res.json();
}
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year:"numeric", month:"2-digit", day:"2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour:"2-digit", minute:"2-digit", hour12:false });

const eventName = new Map();
let u = "/check-ins/v2/attendance_types?per_page=100&include=event";
while (u) {
  const j = await get(u); if (!j) break;
  const evs = new Map((j.included ?? []).filter(i=>i.type==="Event").map(i=>[i.id, i.attributes?.name ?? ""]));
  for (const t of j.data ?? []) { const id = t.relationships?.event?.data?.id; if (id) eventName.set(t.id, evs.get(id) ?? ""); }
  u = j.links?.next ? j.links.next.replace("https://api.planningcenteronline.com","") : null;
}
console.log(`attendance types: ${eventName.size}`);

const up = db.prepare(`INSERT INTO pco_headcounts
  (org_id, pco_id, event_time_id, attendance_type_id, attendance_type, event_name,
   starts_at, local_date, local_time, total, pco_created_at, pco_updated_at, synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(org_id, pco_id) DO UPDATE SET
    attendance_type=excluded.attendance_type, event_name=excluded.event_name,
    starts_at=excluded.starts_at, local_date=excluded.local_date, local_time=excluded.local_time,
    total=excluded.total, pco_updated_at=excluded.pco_updated_at, synced_at=excluded.synced_at`);

let fetched = 0, pages = 0;
u = "/check-ins/v2/headcounts?per_page=100&order=-updated_at&include=event_time,attendance_type";
const t0 = Date.now();
while (u) {
  const j = await get(u); if (!j) break;
  const inc = new Map((j.included ?? []).map(i=>[`${i.type}:${i.id}`, i]));
  const tx = db.transaction(() => {
    for (const h of j.data ?? []) {
      const a = h.attributes ?? {};
      const etId = h.relationships?.event_time?.data?.id ?? null;
      const atId = h.relationships?.attendance_type?.data?.id ?? null;
      const et = etId ? inc.get(`EventTime:${etId}`) : null;
      const at = atId ? inc.get(`AttendanceType:${atId}`) : null;
      const startsAt = et?.attributes?.starts_at ?? null;
      const d = startsAt ? new Date(startsAt) : null;
      up.run(orgId, h.id, etId, atId, at?.attributes?.name ?? null,
        atId ? eventName.get(atId) ?? null : null, startsAt,
        d ? dateFmt.format(d) : null, d ? timeFmt.format(d) : null,
        typeof a.total === "number" ? a.total : null,
        a.created_at ?? null, a.updated_at ?? null);
      fetched++;
    }
  });
  tx();
  pages++;
  if (pages % 20 === 0) process.stdout.write(`  ${fetched} headcounts, ${pages} pages (${Math.round((Date.now()-t0)/1000)}s)\n`);
  u = j.links?.next ? j.links.next.replace("https://api.planningcenteronline.com","") : null;
}
console.log(`\nstored ${fetched} headcounts in ${pages} pages, ${Math.round((Date.now()-t0)/1000)}s`);
for (const r of db.prepare(`SELECT COUNT(*) n, MIN(local_date) a, MAX(local_date) b,
   COUNT(DISTINCT attendance_type) types FROM pco_headcounts WHERE org_id=?`).all(orgId))
  console.log(`  ${r.n} rows, ${r.a} .. ${r.b}, ${r.types} attendance types`);
console.log("\nNow run the projection from the app (it is part of the sync), or check:");
console.log("  SELECT COUNT(*) FROM pco_headcounts WHERE org_id=1 AND strftime('%w',local_date)='0';");
