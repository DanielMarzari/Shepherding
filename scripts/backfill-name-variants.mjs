// One-time backfill of pco_people.nickname / given_name from PCO.
//
// PCO keeps three first-name forms (first_name, nickname, given_name) and we
// only ever stored first_name, so donor matching missed people who give under
// a different form — e.g. "Jung Cho" vs PCO's first_name "John", given_name
// "Jung". The nightly sync fills these going forward, but it's incremental, so
// existing records need one pass.
//
// Run on the server with the app env loaded:
//   set -a; . /var/www/apps/shepherdly/.env.production; set +a
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db node scripts/backfill-name-variants.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "shepherding.db");
const ORG_ID = process.env.ORG_ID ? Number(process.env.ORG_ID) : 1;
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || "", "base64");
if (KEY.length !== 32) {
  console.error("ENCRYPTION_KEY missing/invalid — load the app env first.");
  process.exit(1);
}
function decrypt(payload) {
  const b = Buffer.from(payload, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 15000");
// Columns normally arrive via migration 0079. If we add them out-of-band we
// MUST record the migration too, or the next deploy re-runs it, hits
// "duplicate column name", and aborts before pm2 restarts.
const cols = db.prepare("PRAGMA table_info(pco_people)").all().map((c) => c.name);
if (!cols.includes("nickname") || !cols.includes("given_name")) {
  if (!cols.includes("nickname")) db.exec("ALTER TABLE pco_people ADD COLUMN nickname TEXT");
  if (!cols.includes("given_name")) db.exec("ALTER TABLE pco_people ADD COLUMN given_name TEXT");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  db.prepare("INSERT OR IGNORE INTO _migrations (filename) VALUES (?)").run(
    "0079_person_name_variants.sql",
  );
  console.log("Added nickname/given_name and recorded migration 0079 as applied.");
}

const cred = db.prepare("SELECT app_id_enc, secret_enc FROM pco_credentials WHERE org_id=?").get(ORG_ID);
if (!cred) { console.error("No PCO credentials for org", ORG_ID); process.exit(1); }
const auth = "Basic " + Buffer.from(decrypt(cred.app_id_enc) + ":" + decrypt(cred.secret_enc)).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, attempt = 0) {
  const res = await fetch(url.startsWith("http") ? url : "https://api.planningcenteronline.com" + url, {
    headers: { Authorization: auth, Accept: "application/json", "User-Agent": "Shepherding/name-variants" },
  });
  if (res.status === 429 && attempt < 5) {
    await sleep((parseInt(res.headers.get("Retry-After") || "20", 10) || 20) * 1000);
    return getJson(url, attempt + 1);
  }
  if (res.status >= 500 && attempt < 5) { await sleep(1000 * 2 ** attempt); return getJson(url, attempt + 1); }
  if (!res.ok) throw new Error(`PCO ${res.status} ${res.statusText}`);
  return res.json();
}

const upd = db.prepare("UPDATE pco_people SET nickname = ?, given_name = ? WHERE org_id = ? AND pco_id = ?");
let url = "/people/v2/people?per_page=100";
let seen = 0, withNick = 0, withGiven = 0, pages = 0;
while (url) {
  const page = await getJson(url);
  const tx = db.transaction((rows) => {
    for (const p of rows) {
      const a = p.attributes || {};
      const nick = (a.nickname ?? null) || null;
      const given = (a.given_name ?? null) || null;
      upd.run(nick, given, ORG_ID, p.id);
      seen++;
      if (nick) withNick++;
      if (given) withGiven++;
    }
  });
  tx(page.data || []);
  url = page.links?.next ?? null;
  if (++pages % 25 === 0) console.log(`  ${seen} people…`);
  await sleep(200);
}
console.log(`Done. ${seen} people: ${withNick} have a nickname, ${withGiven} have a given_name.`);
