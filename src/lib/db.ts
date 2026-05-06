import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let _db: Database.Database | null = null;

function dbPath(): string {
  return process.env.DATABASE_PATH ?? path.join(process.cwd(), "shepherding.db");
}

function migrationsDir(): string {
  return path.join(process.cwd(), "db", "migrations");
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureMigrationsApplied(db);
  _db = db;
  return db;
}

function ensureMigrationsApplied(db: Database.Database) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
  );
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) return;
  const applied = new Set(
    db
      .prepare("SELECT filename FROM _migrations")
      .all()
      .map((r) => (r as { filename: string }).filename),
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    db.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(f);
  }
}
