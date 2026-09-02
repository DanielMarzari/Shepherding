// One-time backfill of PCO Services plan ITEMS (the order of service) for the
// worship service types, into pco_plan_items. The nightly sync keeps a rolling
// 6-week window fresh (see pco-sync-services.ts); this pulls the history once.
//
// Uses the app's own encrypted PCO creds — run with the app env loaded so
// ENCRYPTION_KEY is present, e.g. on the server:
//   set -a; . /var/www/apps/shepherdly/.env.production; set +a
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db node scripts/backfill-plan-items.mjs
//
// Env: ENCRYPTION_KEY (required), DATABASE_PATH, ORG_ID=1,
//      SINCE=2018-01-01, ST_IDS=116463,156862
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "shepherding.db");
const ORG_ID = process.env.ORG_ID ? Number(process.env.ORG_ID) : 1;
const SINCE = process.env.SINCE || "2018-01-01";
const ST_IDS = (process.env.ST_IDS || "116463,156862").split(",").map((s) => s.trim());
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || "", "base64");
if (KEY.length !== 32) {
  console.error("ENCRYPTION_KEY missing/invalid (need 32 bytes base64). Load the app env first.");
  process.exit(1);
}

function decrypt(payload) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 15000");
db.exec(`CREATE TABLE IF NOT EXISTS pco_plan_items (
  org_id INTEGER NOT NULL, pco_id TEXT NOT NULL, plan_id TEXT NOT NULL, service_type_id TEXT,
  sequence INTEGER, item_type TEXT, title TEXT, description TEXT, html_details TEXT, length INTEGER,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (org_id, pco_id));
CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON pco_plan_items(org_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_st ON pco_plan_items(org_id, service_type_id);`);

const cred = db.prepare("SELECT app_id_enc, secret_enc FROM pco_credentials WHERE org_id=?").get(ORG_ID);
if (!cred) { console.error("No PCO credentials for org", ORG_ID); process.exit(1); }
const auth = "Basic " + Buffer.from(decrypt(cred.app_id_enc) + ":" + decrypt(cred.secret_enc)).toString("base64");
const BASE = "https://api.planningcenteronline.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, attempt = 0) {
  const res = await fetch(url.startsWith("http") ? url : BASE + url, {
    headers: { Authorization: auth, Accept: "application/json", "User-Agent": "Shepherding/plan-items-backfill" },
  });
  if (res.status === 429 && attempt < 5) {
    const ra = parseInt(res.headers.get("Retry-After") || "20", 10);
    await sleep((Number.isFinite(ra) ? ra : 20) * 1000);
    return getJson(url, attempt + 1);
  }
  if (res.status >= 500 && attempt < 5) { await sleep(1000 * 2 ** attempt); return getJson(url, attempt + 1); }
  if (!res.ok) throw new Error(`PCO ${res.status} ${res.statusText} on ${url}`);
  return res.json();
}

const replacePlan = db.transaction((planId, stId, rows) => {
  db.prepare("DELETE FROM pco_plan_items WHERE org_id=? AND plan_id=?").run(ORG_ID, planId);
  const ins = db.prepare(`INSERT INTO pco_plan_items
    (org_id, pco_id, plan_id, service_type_id, sequence, item_type, title, description, html_details, length, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(org_id,pco_id) DO UPDATE SET plan_id=excluded.plan_id, service_type_id=excluded.service_type_id,
      sequence=excluded.sequence, item_type=excluded.item_type, title=excluded.title, description=excluded.description,
      html_details=excluded.html_details, length=excluded.length, synced_at=excluded.synced_at`);
  for (const r of rows) ins.run(ORG_ID, r.id, planId, stId, r.sequence, r.item_type, r.title, r.description, r.html_details, r.length);
});

const plans = db.prepare(
  `SELECT pco_id, service_type_id, sort_date FROM pco_plans
    WHERE org_id=? AND service_type_id IN (${ST_IDS.map(() => "?").join(",")}) AND sort_date >= ?
    ORDER BY sort_date ASC`,
).all(ORG_ID, ...ST_IDS, SINCE);

console.log(`Backfilling items for ${plans.length} plans (STs ${ST_IDS.join(",")}, since ${SINCE})…`);
let done = 0, items = 0, errs = 0;
for (const p of plans) {
  try {
    let url = `/services/v2/service_types/${p.service_type_id}/plans/${p.pco_id}/items?per_page=200`;
    const rows = [];
    while (url) {
      const page = await getJson(url);
      for (const it of page.data || []) {
        const a = it.attributes || {};
        rows.push({
          id: it.id,
          sequence: a.sequence ?? null,
          item_type: a.item_type ?? null,
          title: a.title ?? null,
          description: a.description ?? null,
          html_details: a.html_details ?? null,
          length: a.length ?? null,
        });
      }
      url = page.links?.next ?? null;
    }
    replacePlan(p.pco_id, p.service_type_id, rows);
    items += rows.length;
    await sleep(250); // ~4 req/s, comfortably under PCO's 100/20s
  } catch (e) {
    errs++;
    console.error(`  plan ${p.pco_id} (${p.sort_date}) failed: ${e.message}`);
  }
  if (++done % 100 === 0) console.log(`  ${done}/${plans.length} plans, ${items} items…`);
}
console.log(`Done. ${done} plans, ${items} items, ${errs} errors.`);
