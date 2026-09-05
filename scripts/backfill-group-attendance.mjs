// One-time backfill of pco_event_attendances for historical group events.
//
// The nightly sync re-fetches group events only for the last
// `sync_threshold_months` (3), and attendance is pulled only for the events in
// that batch. Events themselves were fetched in full on the first sync — 13,004
// of them back to 2016 — so the table has every meeting and attendance for
// almost none of them: 5,409 rows, all 2026.
//
// PCO still holds the rest. Sampling twelve small-group events per year found
// attendance rows in every year from 2019 on, so "attendance per group per
// session, overlaid by year" is answerable — it just needs one pass over the
// events we already know about.
//
// Idempotent and resumable: it only visits events with no attendance row yet,
// and upserts, so re-running costs API calls but changes nothing else. Safe to
// stop and restart.
//
// Run on the server with the app env loaded:
//   set -a; . /var/www/apps/shepherdly/.env.production; set +a
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db node scripts/backfill-group-attendance.mjs
//
// Options (env):
//   SINCE=2019-01-01   only events starting on/after this date (default: all)
//   LIMIT=500          stop after this many events (default: all)
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const Database = require(process.env.BETTER_SQLITE3 ?? "better-sqlite3");

const DB_PATH = process.env.DATABASE_PATH;
if (!DB_PATH) throw new Error("DATABASE_PATH is required");
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 10000");

const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
function decrypt(payload) {
  const b = Buffer.from(payload, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

const orgId = 1;
const cred = db.prepare("SELECT app_id_enc, secret_enc FROM pco_credentials WHERE org_id = ?").get(orgId);
if (!cred) throw new Error("no PCO credentials for org " + orgId);
const auth = "Basic " + Buffer.from(`${decrypt(cred.app_id_enc)}:${decrypt(cred.secret_enc)}`).toString("base64");

// PCO allows 100 requests per 20s. Track the headers and sleep before hitting
// the wall rather than eating 429s.
let sleepUntil = 0;
async function getJson(url, attempt = 0) {
  const wait = sleepUntil - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  let res;
  try {
    res = await fetch("https://api.planningcenteronline.com" + url, { headers: { Authorization: auth } });
  } catch (e) {
    if (attempt >= 3) throw e;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return getJson(url, attempt + 1);
  }
  const limit = Number(res.headers.get("x-pco-api-request-rate-limit") ?? 100);
  const count = Number(res.headers.get("x-pco-api-request-rate-count") ?? 0);
  const period = Number(res.headers.get("x-pco-api-request-rate-period") ?? 20);
  if (count >= limit - 5) sleepUntil = Date.now() + period * 1000;
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? period);
    sleepUntil = Date.now() + retry * 1000;
    if (attempt >= 5) throw new Error("429 after retries: " + url);
    return getJson(url, attempt + 1);
  }
  if (!res.ok) {
    // A deleted event 404s; that is a fact about the event, not a failure.
    if (res.status === 404) return null;
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return getJson(url, attempt + 1);
  }
  return res.json();
}

const since = process.env.SINCE ?? "";
const limit = Number(process.env.LIMIT ?? 0);
const events = db
  .prepare(
    `SELECT e.pco_id, e.starts_at, e.group_id
       FROM pco_group_events e
      WHERE e.org_id = ? AND e.canceled = 0 AND e.starts_at IS NOT NULL
        -- Group events run out to 2027 in this data. A meeting that has not
        -- happened has no attendance to fetch, and there are thousands of them.
        AND e.starts_at <= strftime('%Y-%m-%dT%H:%M:%SZ','now')
        AND (? = '' OR e.starts_at >= ?)
        AND NOT EXISTS (
          SELECT 1 FROM pco_event_attendances a
           WHERE a.org_id = e.org_id AND a.event_id = e.pco_id)
      ORDER BY e.starts_at DESC`,
  )
  .all(orgId, since, since);
const targets = limit > 0 ? events.slice(0, limit) : events;

const ins = db.prepare(
  `INSERT INTO pco_event_attendances
     (org_id, event_id, person_id, group_id, attended, pco_created_at, event_starts_at, synced_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   ON CONFLICT(org_id, event_id, person_id) DO UPDATE SET
     group_id = excluded.group_id,
     attended = excluded.attended,
     pco_created_at = excluded.pco_created_at,
     event_starts_at = excluded.event_starts_at,
     synced_at = excluded.synced_at`,
);
const writeRows = db.transaction((rows) => {
  for (const r of rows) ins.run(orgId, r.eventId, r.personId, r.groupId, r.attended, r.createdAt, r.startsAt);
});

const before = db.prepare("SELECT COUNT(*) n FROM pco_event_attendances WHERE org_id = ?").get(orgId).n;
console.log(`events needing attendance: ${targets.length} (of ${events.length} candidates)`);
console.log(`attendance rows before: ${before}`);

let done = 0, withRows = 0, inserted = 0, gone = 0;
const started = Date.now();
for (const ev of targets) {
  const rows = [];
  let url = `/groups/v2/events/${ev.pco_id}/attendances?per_page=100`;
  while (url) {
    const j = await getJson(url);
    if (j === null) { gone++; break; }
    for (const a of j.data ?? []) {
      const personId = a.relationships?.person?.data?.id;
      if (!personId) continue;
      rows.push({
        eventId: ev.pco_id,
        personId,
        groupId: ev.group_id,
        attended: a.attributes?.attended === true ? 1 : 0,
        createdAt: a.attributes?.created_at ?? null,
        startsAt: ev.starts_at,
      });
    }
    const next = j.links?.next;
    url = next ? next.replace("https://api.planningcenteronline.com", "") : null;
  }
  if (rows.length) { writeRows(rows); withRows++; inserted += rows.length; }
  done++;
  if (done % 100 === 0) {
    const rate = done / ((Date.now() - started) / 1000);
    const eta = Math.round((targets.length - done) / rate / 60);
    console.log(`  ${done}/${targets.length}  events with attendance: ${withRows}  rows: ${inserted}  gone: ${gone}  eta ${eta}m`);
  }
}

const after = db.prepare("SELECT COUNT(*) n FROM pco_event_attendances WHERE org_id = ?").get(orgId).n;
console.log(`\nvisited ${done} events; ${withRows} had attendance; ${gone} no longer in PCO`);
console.log(`attendance rows: ${before} -> ${after}`);
console.log(
  "by year: " +
    JSON.stringify(
      db
        .prepare(
          `SELECT substr(event_starts_at,1,4) yr, COUNT(*) rows, SUM(attended) attended, COUNT(DISTINCT group_id) groups
             FROM pco_event_attendances WHERE org_id = ? GROUP BY 1 ORDER BY 1`,
        )
        .all(orgId),
    ),
);
