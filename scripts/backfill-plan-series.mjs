// One-time fill of pco_plans.series_title / series_id (migration 0085).
//
// The recurring Services sync captures these from now on; this reaches back
// over every plan we already hold so the sermon archive gets its series
// immediately rather than after a rolling window catches up.
//
// Idempotent: a plain UPDATE keyed on the PCO plan id. Safe to re-run.
//
// Run on the server with the app env loaded:
//   set -a; . /var/www/apps/shepherdly/.env.production; set +a
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db \
//     node scripts/backfill-plan-series.mjs
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

const serviceTypes = db
  .prepare("SELECT DISTINCT service_type_id AS id FROM pco_plans WHERE org_id = ? AND service_type_id IS NOT NULL")
  .all(orgId)
  .map((r) => r.id);
console.log(`${serviceTypes.length} service types to walk`);

const upd = db.prepare(
  "UPDATE pco_plans SET series_title = ?, series_id = ? WHERE org_id = ? AND pco_id = ?",
);
let seen = 0, withSeries = 0, changed = 0;
for (const stId of serviceTypes) {
  let url = `/services/v2/service_types/${stId}/plans?per_page=100&order=-sort_date`;
  const rows = [];
  while (url) {
    const j = await get(url);
    if (!j) break;
    for (const p of j.data ?? []) {
      const a = p.attributes ?? {};
      const rel = p.relationships?.series?.data;
      rows.push({
        id: p.id,
        title: typeof a.series_title === "string" && a.series_title ? a.series_title : null,
        sid: !rel || Array.isArray(rel) ? null : rel.id,
      });
    }
    url = j.links?.next ? j.links.next.replace("https://api.planningcenteronline.com", "") : null;
  }
  const tx = db.transaction(() => {
    for (const r of rows) {
      seen++;
      if (r.title) withSeries++;
      changed += upd.run(r.title, r.sid, orgId, r.id).changes;
    }
  });
  tx();
  process.stdout.write(`  service type ${stId}: ${rows.length} plans\n`);
}
console.log(`\n${seen} plans seen, ${withSeries} carry a series, ${changed} rows updated`);

console.log("\nSeries by year (plans that name one):");
for (const r of db
  .prepare(
    `SELECT substr(sort_date,1,4) yr, COUNT(DISTINCT series_id) series, COUNT(*) plans
       FROM pco_plans WHERE org_id = ? AND series_id IS NOT NULL AND sort_date <= datetime('now')
      GROUP BY 1 ORDER BY 1`,
  )
  .all(orgId)) {
  console.log(`  ${r.yr}  ${String(r.series).padStart(3)} series across ${r.plans} plans`);
}
console.log("\nSermons that can now name their series:");
console.log(
  JSON.stringify(
    db
      .prepare(
        `SELECT COUNT(*) sermons,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM pco_plans pl
                      JOIN pco_service_types st ON st.pco_id = pl.service_type_id AND st.org_id = ?
                     WHERE pl.org_id = ? AND st.name LIKE 'LIVE%'
                       AND substr(pl.sort_date,1,10) = s.preached_on
                       AND pl.series_title IS NOT NULL) THEN 1 ELSE 0 END) with_series
           FROM sermons s WHERE s.org_id = ?`,
      )
      .get(orgId, orgId, orgId),
  ),
);
