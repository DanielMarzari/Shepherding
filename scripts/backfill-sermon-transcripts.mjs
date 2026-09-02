// Copy each sermon's full transcript text from the Sermon Lab SQLite DB into
// shepherdly's `sermons.transcript`, so the Sermons explorer can render the
// message with its next-step calls highlighted in place.
//
// Both DBs live on the same host. Usage (on the server):
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db \
//   SERMON_LAB_DB=/var/www/apps/sermon-lab/sermon-lab.db \
//   node scripts/backfill-sermon-transcripts.mjs
//
// Idempotent: re-running just refreshes the text. Picks the LONGEST transcript
// per source (some sermons were transcribed more than once).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "shepherding.db");
const LAB_PATH = process.env.SERMON_LAB_DB || "/var/www/apps/sermon-lab/sermon-lab.db";
const ORG_ID = process.env.ORG_ID ? Number(process.env.ORG_ID) : 1;

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 15000");
// Column normally arrives via migration 0078. If we add it out-of-band here,
// we MUST also record 0078 as applied — otherwise the next deploy re-runs the
// migration, hits "duplicate column name", and aborts before pm2 restarts.
const cols = db.prepare("PRAGMA table_info(sermons)").all().map((c) => c.name);
if (!cols.includes("transcript")) {
  db.exec("ALTER TABLE sermons ADD COLUMN transcript TEXT");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  db.prepare("INSERT OR IGNORE INTO _migrations (filename) VALUES (?)").run(
    "0078_sermon_transcript.sql",
  );
  console.log("Added transcript column and recorded migration 0078 as applied.");
}

const lab = new Database(LAB_PATH, { readonly: true });
const pick = lab.prepare(
  "SELECT text FROM transcripts WHERE source_id = ? ORDER BY length(text) DESC LIMIT 1",
);

const targets = db
  .prepare("SELECT source_id FROM sermons WHERE org_id = ?")
  .all(ORG_ID);
const upd = db.prepare("UPDATE sermons SET transcript = ? WHERE org_id = ? AND source_id = ?");

let filled = 0,
  missing = 0;
const tx = db.transaction(() => {
  for (const { source_id } of targets) {
    const row = pick.get(source_id);
    if (!row?.text) {
      missing++;
      continue;
    }
    upd.run(row.text, ORG_ID, source_id);
    filled++;
  }
});
tx();

console.log(`Transcripts: ${filled} filled, ${missing} missing, of ${targets.length} sermons.`);
