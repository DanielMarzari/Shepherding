// Weekly pull of new sermons from the Sermon Lab app into `sermons`.
//
// Sermon Lab (a separate app on this host) ingests the podcast feed and
// transcribes each message. This copies anything new into shepherdly with its
// transcript, and DELIBERATELY LEAVES IT UNCLASSIFIED — topic, summary,
// next_steps and classified_at stay NULL. Classification needs a model, which a
// cron job has no business invoking on its own, so a new sermon lands in a
// queue instead and waits to be analysed on request.
//
// Read `sermons WHERE classified_at IS NULL AND transcript IS NOT NULL` to see
// what is waiting; the Sunday Teaching report surfaces the same count.
//
// preached_on is the Sunday ON OR BEFORE published_at: the feed publishes on
// the Monday, so 2026-08-03 is the sermon preached 2026-08-02. Verified against
// every row already in the table.
//
// Idempotent: existing sermons are never overwritten, so a classification
// already made is safe. A sermon that somehow arrived without its transcript
// gets one filled in.
//
// Run on the server:
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db \
//   SERMON_LAB_DB=/var/www/apps/sermon-lab/sermon-lab.db \
//   node scripts/sync-sermons-from-lab.mjs
//
// Options (env): ORG_ID (shepherdly org, default 1), LAB_ORG_ID (Sermon Lab org,
// default 1 = Faith Church — org 2 is Bible Project and must not be imported).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require(process.env.BETTER_SQLITE3 ?? "better-sqlite3");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "shepherding.db");
const LAB_PATH = process.env.SERMON_LAB_DB || "/var/www/apps/sermon-lab/sermon-lab.db";
const ORG_ID = process.env.ORG_ID ? Number(process.env.ORG_ID) : 1;
const LAB_ORG_ID = process.env.LAB_ORG_ID ? Number(process.env.LAB_ORG_ID) : 1;

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 15000");
const lab = new Database(LAB_PATH, { readonly: true });

/** The Sunday on or before an ISO timestamp. */
function sundayOnOrBefore(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay: 0 = Sunday
  return d.toISOString().slice(0, 10);
}

const have = new Map(
  db
    .prepare("SELECT source_id, transcript FROM sermons WHERE org_id = ?")
    .all(ORG_ID)
    .map((r) => [r.source_id, r.transcript]),
);

const sources = lab
  .prepare(
    `SELECT s.id, s.title, s.scripture, s.published_at, sp.name AS speaker
       FROM sources s
       LEFT JOIN speakers sp ON sp.id = s.speaker_id
      WHERE s.org_id = ?
      ORDER BY s.published_at`,
  )
  .all(LAB_ORG_ID);

const pickTranscript = lab.prepare(
  "SELECT text, word_count FROM transcripts WHERE source_id = ? ORDER BY length(text) DESC LIMIT 1",
);

const insert = db.prepare(
  `INSERT INTO sermons (org_id, source_id, preached_on, title, scripture, speaker, word_count, transcript)
   VALUES (@orgId, @sourceId, @preachedOn, @title, @scripture, @speaker, @wordCount, @transcript)`,
);
const fillTranscript = db.prepare(
  "UPDATE sermons SET transcript = ?, word_count = COALESCE(word_count, ?) WHERE org_id = ? AND source_id = ?",
);

let added = 0, filled = 0, skippedNoTranscript = 0, already = 0;
const run = db.transaction(() => {
  for (const s of sources) {
    const tx = pickTranscript.get(s.id);
    if (have.has(s.id)) {
      already++;
      // Only ever ADD a missing transcript; never overwrite one, and never
      // touch a classification that has already been made.
      if (!have.get(s.id) && tx?.text) {
        fillTranscript.run(tx.text, tx.word_count ?? null, ORG_ID, s.id);
        filled++;
      }
      continue;
    }
    // A sermon with no transcript yet is not ready — Sermon Lab is still
    // working on it. Leave it for next week rather than importing a shell.
    if (!tx?.text) {
      skippedNoTranscript++;
      continue;
    }
    const preachedOn = sundayOnOrBefore(s.published_at);
    if (!preachedOn) {
      skippedNoTranscript++;
      continue;
    }
    insert.run({
      orgId: ORG_ID,
      sourceId: s.id,
      preachedOn,
      title: s.title ?? null,
      scripture: s.scripture ?? null,
      speaker: s.speaker ?? null,
      wordCount: tx.word_count ?? null,
      transcript: tx.text,
    });
    added++;
  }
});
run();

const queue = db
  .prepare(
    `SELECT COUNT(*) n FROM sermons
      WHERE org_id = ? AND classified_at IS NULL AND transcript IS NOT NULL AND transcript <> ''`,
  )
  .get(ORG_ID).n;

console.log(
  `Sermon Lab org ${LAB_ORG_ID}: ${sources.length} sources | added ${added}, transcripts filled ${filled}, already held ${already}, not ready ${skippedNoTranscript}`,
);
console.log(`Awaiting analysis: ${queue}`);
if (queue > 0) {
  for (const r of db
    .prepare(
      `SELECT preached_on, title, speaker FROM sermons
        WHERE org_id = ? AND classified_at IS NULL AND transcript IS NOT NULL AND transcript <> ''
        ORDER BY preached_on DESC LIMIT 20`,
    )
    .all(ORG_ID)) {
    console.log(`  ${r.preached_on}  ${r.speaker ?? "?"} — ${r.title ?? "(untitled)"}`);
  }
}
