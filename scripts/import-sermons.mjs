// Load the classified Faith Church sermons (db/seed-data/sermons.json) into the
// `sermons` table. Idempotent upsert on (org_id, source_id) — safe to re-run.
//
// The data is produced by classifying each Sermon Lab transcript for topic +
// next-step calls (giving / groups / serving / outreach / …); see
// src/lib/sermon-impact.ts for how the table is consumed.
//
// Usage (from repo root):
//   DATABASE_PATH=/var/www/apps/shepherdly/shepherdly.db node scripts/import-sermons.mjs
//   ORG_ID=1 node scripts/import-sermons.mjs        # ORG_ID defaults to 1
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "shepherding.db");
const ORG_ID = process.env.ORG_ID ? Number(process.env.ORG_ID) : 1;
const SEED = path.join(__dirname, "..", "db", "seed-data", "sermons.json");

const rows = JSON.parse(readFileSync(SEED, "utf8"));
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 10000");

// Table normally arrives via migration 0076; create-if-missing keeps this
// script runnable on its own (e.g. a fresh restore before migrations run).
db.exec(`CREATE TABLE IF NOT EXISTS sermons (
  org_id INTEGER NOT NULL, source_id INTEGER NOT NULL, preached_on TEXT NOT NULL,
  title TEXT, scripture TEXT, speaker TEXT, word_count INTEGER,
  topic TEXT, summary TEXT, next_steps TEXT, themes TEXT, confidence REAL,
  classifier TEXT, classified_at TEXT, PRIMARY KEY (org_id, source_id));
CREATE INDEX IF NOT EXISTS idx_sermons_org_date ON sermons(org_id, preached_on);`);

const now = new Date().toISOString();
const up = db.prepare(`INSERT INTO sermons
  (org_id, source_id, preached_on, title, scripture, speaker, word_count, topic, summary, next_steps, themes, confidence, classifier, classified_at)
  VALUES (@org_id, @source_id, @preached_on, @title, @scripture, @speaker, @word_count, @topic, @summary, @next_steps, @themes, @confidence, @classifier, @classified_at)
  ON CONFLICT(org_id, source_id) DO UPDATE SET
    preached_on=excluded.preached_on, title=excluded.title, scripture=excluded.scripture,
    speaker=excluded.speaker, word_count=excluded.word_count, topic=excluded.topic,
    summary=excluded.summary, next_steps=excluded.next_steps, themes=excluded.themes,
    confidence=excluded.confidence, classifier=excluded.classifier, classified_at=excluded.classified_at`);

const tx = db.transaction((rs) => {
  for (const r of rs) up.run({ org_id: ORG_ID, classifier: "opus-sermon-classifier-v1", classified_at: now, ...r });
});
tx(rows);

const total = db.prepare("SELECT COUNT(*) c FROM sermons WHERE org_id=?").get(ORG_ID).c;
console.log(`Imported ${rows.length} sermons into ${DB_PATH} (org ${ORG_ID}); table now holds ${total}.`);
