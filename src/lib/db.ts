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
  // Speed tuning, sized against a 150 MB RSS ceiling rather than against an
  // empty machine. The previous settings — 64 MB page cache and a 256 MB mmap
  // window, on BOTH this connection and the read-only one in builder.ts — cost
  // a measured 104 MB of RSS for a single connection running four report
  // queries. pm2 restarts this app at 150 MB and had done so 98 times.
  //
  // Measured on production, one connection, four real report queries:
  //   64 MB cache + 256 MB mmap  ->  +104.5 MB RSS, "Kids checked in" 566 ms
  //    8 MB cache +  64 MB mmap  ->   +62.7 MB RSS, 846 ms
  //    2 MB cache +   0    mmap  ->     ~0   MB RSS, 1295 ms
  // So the whole cost of giving that memory back is under a second on the
  // heaviest queries, which is the trade the church asked for: a page that
  // loads fast may take a moment to fill in its data.
  //
  // mmap_size is 0 deliberately. Mapped pages are clean and file-backed, so
  // they are cheap for the KERNEL — but pm2 measures RSS, which counts them,
  // so they are expensive for US. The host already holds ~465 MB of page
  // cache, so the file stays cached by the OS either way.
  db.pragma("cache_size = -16384"); // 16 MB page cache (negative = KiB)
  db.pragma("mmap_size = 0"); // no memory-mapped reads — see above
  db.pragma("temp_store = MEMORY"); // TEMP tables/indexes in RAM
  // A hard ceiling on everything SQLite allocates on this connection,
  // regardless of cache_size, so a pathological query cannot walk the process
  // into a restart.
  db.pragma("soft_heap_limit = 33554432"); // 32 MB
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

/** Return SQLite's page cache to the OS.
 *
 *  Node does not hand freed heap back eagerly and neither does SQLite: after a
 *  full sync the page cache stays at its high-water mark for the life of the
 *  process, which on a 150 MB ceiling is the difference between running and
 *  being restarted. Called at the end of a sync, where the peak is made. */
export function shrinkDbMemory() {
  try {
    _db?.pragma("shrink_memory");
  } catch {
    // Best effort — never let a memory hint fail a sync.
  }
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
