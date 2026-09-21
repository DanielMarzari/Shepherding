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
  // Planner statistics, following SQLite's documented pattern for a
  // long-lived connection: optimize=0x10002 at open, plain optimize
  // periodically (optimizeDb, after every sync attempt).
  //
  // This used to be a bare "PRAGMA optimize" here, which only re-analyzes
  // tables the connection has already queried — none, on a connection that
  // was opened a microsecond ago — so it never did anything and the stats
  // drifted 20x from the real row counts. 0x10000 makes it check every table.
  //
  // analysis_limit = 0 means a table it does re-analyze gets FULL statistics.
  // A sample is badly wrong here: every index leads with org_id (one value)
  // then the person, so a 400-entry sample saw a handful of people, costed
  // each at 401 check-ins (really 32), and sent per-person lookups on a scan
  // of the whole org — measured 0.01 ms -> 13 ms. See 0088. With stats kept
  // current by the migrations, optimize rarely has anything to re-analyze:
  // 10 ms at open on a production copy.
  try {
    db.pragma("analysis_limit = 0");
    db.pragma("optimize = 0x10002");
  } catch {
    // PRAGMA optimize is best-effort — never block startup on it.
  }
  _db = db;
  return db;
}

/** Re-analyze any table this connection has queried whose row count has
 *  moved 10x since its statistics were taken. Run after every sync attempt,
 *  the one operation that changes row counts at scale. Measured on a
 *  production copy after a snapshot rebuild: 0.2 ms with nothing to do,
 *  16 ms with pco_event_attendances' stats set back to 20x stale. */
export function optimizeDb() {
  try {
    _db?.pragma("optimize");
  } catch {
    // Best effort — a stats refresh must never fail a sync.
  }
}

/** Prepared statements, one per connection per SQL text.
 *
 *  The sync upserts used to call getDb().prepare(sql) once per ROW — ~41k
 *  compiles on the 2026-09-21 nightly sync, plus up to four per person for
 *  email and phone hashes. Each compile costs ~25 us of CPU, but the real
 *  price is memory: every Statement pins its native sqlite3_stmt until V8
 *  collects the wrapper, and V8 is never told about that memory
 *  (process.memoryUsage().external does not move), so nothing hurries it.
 *
 *  Measured on a production copy, re-upserting 50k real check-ins in the
 *  sync's shape (parse a 110 KB PCO page, upsert its 100 rows, yield):
 *    per-row prepare  ->  +108-115 MB peak RSS, 7.3 s CPU (median of 3)
 *    prepareCached    ->   +10-12 MB peak RSS, 6.4 s CPU
 *  on a process pm2 restarts at 150 MB. In a tight loop without the JSON
 *  garbage the per-row path peaked at +165-497 MB before V8 got round to it.
 *
 *  Only for STATIC SQL used with run(), get() or all(). Never for a statement
 *  used with iterate(): an unfinished iterator leaves the statement busy, and
 *  the next caller of the same SQL would throw. Never for SQL with a variable
 *  number of placeholders either — every distinct string is kept for the life
 *  of the connection. And don't flip modes (pluck/raw/expand/safeIntegers) on
 *  a cached statement; the next caller would inherit them. */
const statementCache = new WeakMap<Database.Database, Map<string, Database.Statement>>();

export function prepareCached(sql: string): Database.Statement {
  const db = getDb();
  let byText = statementCache.get(db);
  if (!byText) {
    byText = new Map();
    statementCache.set(db, byText);
  }
  let stmt = byText.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    byText.set(sql, stmt);
  }
  return stmt;
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
