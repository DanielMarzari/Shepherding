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
  // Wait up to 10s on write-lock contention instead of erroring out
  // immediately. Otherwise a sync running concurrently with a
  // dashboard refresh would SQLITE_BUSY one of them on the first
  // statement of any conflicting transaction.
  db.pragma("busy_timeout = 10000");
  // Speed-only tuning (changes no query result, only how fast it runs).
  // The default 2 MB page cache is far too small for the org-wide aggregate
  // scans the dashboards do; a bigger cache + memory-mapped I/O keeps hot
  // pages resident, and MEMORY temp_store keeps the many staging TEMP tables
  // (dashboard refresh, populateShepherdedTempTable, per-page scope sets) off
  // disk. Sized conservatively for the 33k-person DB.
  db.pragma("cache_size = -65536"); // 64 MB page cache (negative = KiB)
  db.pragma("mmap_size = 268435456"); // 256 MB memory-mapped reads
  db.pragma("temp_store = MEMORY"); // TEMP tables/indexes in RAM
  ensureMigrationsApplied(db);
  // Refresh the query planner's stats so it picks the composite indexes over
  // full scans. Cheap; runs once per process on first connection.
  try {
    db.pragma("optimize");
  } catch {
    // PRAGMA optimize is best-effort — never block startup on it.
  }
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
