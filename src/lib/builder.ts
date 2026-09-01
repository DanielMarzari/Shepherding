import "server-only";
import Database from "better-sqlite3";
import { getDb } from "./db";
import { NAV_SECTION_VALUES } from "./builder-nav";
import { DEFAULT_CONFIG } from "./builder-defaults";

// ─── Read-only query engine ──────────────────────────────────────────
// Blocks can surface ANY data, but only via a read-only connection so a
// query can never write. Two layers of protection: (1) the connection is
// opened `readonly`, so the engine rejects every write; (2) a keyword
// allowlist so we fail fast with a friendly message instead of an engine error.

let _ro: Database.Database | null = null;
function roDb(): Database.Database {
  if (_ro) return _ro;
  const file = getDb().name; // ensures the main DB + migrations are initialized
  const db = new Database(file, { readonly: true });
  db.pragma("busy_timeout = 5000");
  // Speed-only: this connection serves every builder block query serially, so
  // a large page cache + mmap keeps the hot pages resident across blocks.
  db.pragma("cache_size = -65536"); // 64 MB
  db.pragma("mmap_size = 268435456"); // 256 MB
  _ro = db;
  return db;
}

const FORBIDDEN =
  /\b(attach|detach|pragma|insert|update|delete|drop|alter|create|replace|vacuum|reindex|begin|commit|rollback|savepoint|release|load_extension|edit|writefile|fts3_tokenizer)\b/i;
const MAX_ROWS = 1000;
/** A safe SQLite identifier — used to gate the only place we interpolate a name
 *  (PRAGMA can't take a bound parameter) instead of trusting the string. */
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  error?: string;
}

/** One row in the edit-mode query inspector: what a block ran, how long it
 *  took, and its estimated complexity. Produced server-side in render-route. */
export interface QueryDebug {
  blockId: number;
  kind: string;
  title: string;
  /** Named source id (decrypt-capable TS source) when the block uses one. */
  source: string | null;
  /** Raw SQL for SQL blocks; null for source blocks (no SQL to show/EXPLAIN). */
  sql: string | null;
  ms: number;
  rows: number;
  cols: number;
  truncated: boolean;
  error: string | null;
  /** EXPLAIN-derived complexity for SQL blocks; null for source blocks. */
  plan: QueryPlan | null;
}

/** Filter parameters injected into a query as :name placeholders. */
export type QueryParams = Record<string, string>;

/** Named `:param` tokens referenced in a statement, ignoring string literals
 *  and comments so `strftime('%H:%M')` doesn't look like a `:M` parameter. */
export function extractParams(sql: string): string[] {
  const stripped = (sql ?? "")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set<string>();
  for (const m of stripped.matchAll(/:([a-zA-Z_]\w*)/g)) found.add(m[1]);
  return [...found];
}

/** Run a single read-only SELECT/WITH statement, capped at MAX_ROWS.
 *  Any `:name` placeholders are bound from `params` (SQL-injection-safe). */
export function runBuilderQuery(sql: string, params?: QueryParams): QueryResult {
  const empty = (error: string): QueryResult => ({ columns: [], rows: [], truncated: false, error });
  const q = (sql ?? "").trim().replace(/;+\s*$/, "");
  if (!q) return empty("Write a SELECT query to power this block.");
  if (q.includes(";")) return empty("Only a single statement is allowed (no semicolons).");
  if (!/^(select|with)\b/i.test(q)) return empty("Only SELECT / WITH queries are allowed here.");
  if (FORBIDDEN.test(q)) return empty("That query uses a keyword that isn’t allowed (read-only).");
  try {
    const stmt = roDb().prepare(q);
    const names = extractParams(q);
    const bind: QueryParams = {};
    for (const n of names) bind[n] = params?.[n] ?? "";
    const columns = stmt.columns().map((c) => c.name);
    const raw = stmt.raw(true);
    const all = (names.length ? raw.all(bind) : raw.all()) as unknown[][];
    return { columns, rows: all.slice(0, MAX_ROWS), truncated: all.length > MAX_ROWS };
  } catch (e) {
    return empty(e instanceof Error ? e.message : "Query failed.");
  }
}

/** Run a builder query with the current org auto-bound as `:orgId`, so seed /
 *  block SQL can scope itself (`WHERE org_id = :orgId`) without the engine
 *  knowing about orgs. `orgId` is a reserved parameter name. */
export function runBuilderQueryForOrg(orgId: number, sql: string, params?: QueryParams): QueryResult {
  return runBuilderQuery(sql, { ...(params ?? {}), orgId: String(orgId) });
}

/** A read of a query's execution plan → a rough big-O, for the edit-mode
 *  query inspector. We run `EXPLAIN QUERY PLAN` on the read-only connection
 *  (a dedicated path — the EXPLAIN prefix would be rejected by runBuilderQuery)
 *  and classify the plan: full SCANs of a table (no index) are the expensive
 *  steps; SEARCH … USING INDEX / PRIMARY KEY are cheap probes; a CORRELATED
 *  subquery re-runs per outer row (a multiplier). This is a heuristic, not a
 *  measurement — the wall-clock ms next to it is the ground truth. */
export interface QueryPlan {
  /** Coarse big-O in n = rows of the largest table touched. */
  bigO: string;
  /** One-word tier for coloring/sorting: indexed | linear | nested | correlated. */
  tier: "indexed" | "linear" | "nested" | "correlated";
  fullScans: number;
  indexedSteps: number;
  correlated: number;
  /** Raw EXPLAIN QUERY PLAN lines, for the expandable detail. */
  detail: string[];
}
export function explainQueryPlan(sql: string, params?: QueryParams): QueryPlan | null {
  const q = (sql ?? "").trim().replace(/;+\s*$/, "");
  if (!q || q.includes(";") || !/^(select|with)\b/i.test(q) || FORBIDDEN.test(q)) return null;
  try {
    const stmt = roDb().prepare(`EXPLAIN QUERY PLAN ${q}`);
    const names = extractParams(q);
    const bind: QueryParams = {};
    for (const n of names) bind[n] = params?.[n] ?? "";
    const rows = (names.length ? stmt.all(bind) : stmt.all()) as Array<{ detail?: string }>;
    const detail = rows.map((r) => r.detail ?? "").filter(Boolean);
    let fullScans = 0;
    let indexedSteps = 0;
    let correlated = 0;
    for (const d of detail) {
      if (/CORRELATED/i.test(d)) correlated++;
      const usesIndex = /USING\s+(COVERING\s+)?INDEX|USING\s+INTEGER\s+PRIMARY\s+KEY|USING\s+PRIMARY\s+KEY/i.test(d);
      if (/\bSEARCH\b/i.test(d)) indexedSteps++;
      else if (/\bSCAN\b/i.test(d)) {
        if (usesIndex) indexedSteps++;
        else fullScans++;
      }
    }
    let bigO: string;
    let tier: QueryPlan["tier"];
    if (correlated > 0) {
      tier = "correlated";
      bigO = fullScans > 0 ? "O(n·m) — correlated × scan" : "O(n·m) — correlated subquery";
    } else if (fullScans === 0) {
      tier = "indexed";
      bigO = indexedSteps <= 1 ? "O(log n) — indexed" : "O(n log n) — indexed joins";
    } else if (fullScans === 1) {
      tier = "linear";
      bigO = "O(n) — one full scan";
    } else {
      tier = "nested";
      bigO = `O(n${fullScans > 1 ? "^" + fullScans : ""}) — ${fullScans} full scans`;
    }
    return { bigO, tier, fullScans, indexedSteps, correlated, detail };
  } catch {
    return null;
  }
}

/** Table + column names for the SQL editor's autocomplete. */
export interface DbSchema {
  tables: string[];
  columns: Record<string, string[]>;
}
export function getDbSchema(): DbSchema {
  const ro = roDb();
  const tables = (
    ro
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  const columns: Record<string, string[]> = {};
  for (const t of tables) {
    // PRAGMA can't take a bound parameter, so we gate the interpolated name to a
    // strict identifier (belt-and-suspenders: the name already comes from
    // sqlite_master, never user input).
    if (!SAFE_IDENT.test(t)) { columns[t] = []; continue; }
    try {
      columns[t] = (ro.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string }>).map((c) => c.name);
    } catch {
      columns[t] = [];
    }
  }
  return { tables, columns };
}

// ─── Page + block model ──────────────────────────────────────────────

export type BlockKind =
  | "stat"
  | "kpi"
  | "progress"
  | "chart"
  | "table"
  | "leaderboard"
  | "map"
  | "linkcard"
  | "text"
  | "divider"
  | "embed"
  | "filter"
  | "pagelist"
  | "group";

/** One person inside a linkcard connection — an avatar + name that links out
 *  to their PCO profile. Produced by decrypt-capable sources. */
export interface LinkCardPerson {
  name: string;
  /** PCO person id → https://people.planningcenteronline.com/people/{pcoId} */
  pcoId?: string | null;
  initials?: string | null;
  /** A small inline badge on the person (e.g. "inactive"). */
  badge?: string | null;
}
/** A small labelled tag on a linkcard row (confidence, "may be returning", …). */
export interface LinkCardTag {
  label: string;
  tone?: "normal" | "low" | "success" | "warning" | "error" | "highlight";
}

/** A block nested inside a group container. */
export interface ChildBlock {
  kind: BlockKind;
  config: BlockConfig;
}

/** A page reference for the page-list block and menu pages. */
export interface PageRef {
  slug: string;
  title: string;
  description: string | null;
}

export interface BuilderPage {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  /** Sidebar section key the page's link is placed in (null = not in the nav). */
  navSection: string | null;
  /** "See More" page heading the page's link is listed under (null = not listed). */
  moreSection: string | null;
  updatedAt: string;
  blockCount: number;
}

export interface BuilderBlock {
  id: number;
  pageId: number;
  position: number;
  kind: BlockKind;
  config: BlockConfig;
}

export interface BlockConfig {
  title?: string;
  sql?: string;
  /** Named server-side data source (decrypt-capable) instead of raw SQL. See
   *  builder-sources.ts. When set, the block's data comes from the source. */
  source?: string;
  sub?: string;
  text?: string;
  /** Chart type (for kind === "chart"). */
  chartType?: string;
  /** Bar charts: give each bar its own color from the palette (vs one color). */
  colorByCategory?: boolean;
  /** Pictogram symbol id (for chartType === "pictogram"). */
  icon?: string;
  /** Target value for the progress / goal block. */
  goal?: number;
  /** Top-N cap for the leaderboard block. */
  limit?: number;
  /** Filter block: the parameter name injected into other queries as :name. */
  param?: string;
  filterType?: "dropdown" | "chips" | "tabs" | "date" | "text";
  defaultValue?: string;
  /** Embed block: image vs iframe. */
  mode?: "image" | "iframe";
  url?: string;
  alt?: string;
  /** Filter block: block ids this filter re-runs when changed (empty = every
   *  block whose SQL references the :param). */
  targets?: number[];
  /** Page-list block: slugs of the builder pages to link to. */
  pages?: string[];
  /** Group container: nested child blocks. */
  children?: ChildBlock[];
  /** Layout for group / page-list containers. */
  layout?: "list" | "grid";
  /** Block height: standard | double | triple (mainly for maps). */
  height?: "standard" | "double" | "triple";
  /** Table density: condensed (tight, default) or normal (spacious, centered). */
  density?: "condensed" | "normal";
  /** Whole-element preset text color (normal | low | success | warning | error | highlight). */
  color?: "normal" | "low" | "success" | "warning" | "error" | "highlight";
  /** Stat display: a plain number, a normalized ratio (1 : 3 : 5), or the row's
   *  numbers listed raw (15 · 43 · 17). */
  format?: "number" | "ratio" | "list";
  /** For ratio/list stats: a preset color per segment (e.g. green joined · red left). */
  segmentColors?: string[];
  /** Stat: label for a secondary "+N" value (the query's 2nd column), e.g. "kids". */
  secondaryLabel?: string;
  /** Stat / kpi / progress: which result column holds the value (default 0).
   *  Lets several stat cards read different columns of one shared source row. */
  valueColumn?: number;
  /** Table: render these columns' cells as chips/pills. The cell value is a
   *  newline-joined list (sources) or an array; each part becomes a chip. */
  chipColumns?: string[];
  /** Table: click column headers to sort. */
  sortable?: boolean;
  /** Per-table-column preset text color, keyed by column name (a "parts" override). */
  columnColors?: Record<string, string>;
  /** Per-table-column threshold coloring, keyed by column name: cells at/above
   *  base+band are green, at/below base−band are red, in-between amber (invert
   *  flips green/red for lower-is-better columns). */
  columnThresholds?: Record<string, { base: number; band?: number; invert?: boolean }>;
  /** Bento column span (1–6). */
  span?: number;
  [k: string]: unknown;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "page";
}

export function listBuilderPages(orgId: number): BuilderPage[] {
  return getDb()
    .prepare(
      `SELECT p.id, p.slug, p.title, p.description, p.nav_section AS navSection, p.more_section AS moreSection, p.updated_at AS updatedAt,
              (SELECT COUNT(*) FROM builder_blocks b WHERE b.page_id = p.id) AS blockCount
         FROM builder_pages p
        WHERE p.org_id = ?
        ORDER BY p.updated_at DESC`,
    )
    .all(orgId) as BuilderPage[];
}

export function getBuilderPage(orgId: number, slug: string): BuilderPage | null {
  const row = getDb()
    .prepare(
      `SELECT id, slug, title, description, nav_section AS navSection, more_section AS moreSection, updated_at AS updatedAt
         FROM builder_pages WHERE org_id = ? AND slug = ?`,
    )
    .get(orgId, slug) as Omit<BuilderPage, "blockCount"> | undefined;
  return row ? { ...row, blockCount: 0 } : null;
}

/** Pages assigned to a sidebar section, for the left nav. */
export function listNavPages(orgId: number): Array<{ slug: string; title: string; navSection: string }> {
  return getDb()
    .prepare(
      `SELECT slug, title, nav_section AS navSection
         FROM builder_pages
        WHERE org_id = ? AND nav_section IS NOT NULL AND nav_section <> ''
        ORDER BY title`,
    )
    .all(orgId) as Array<{ slug: string; title: string; navSection: string }>;
}

/** Pages listed on the "See More" page, grouped by their heading. */
export function listMorePages(orgId: number): Array<{ slug: string; title: string; description: string | null; moreSection: string }> {
  return getDb()
    .prepare(
      `SELECT slug, title, description, more_section AS moreSection
         FROM builder_pages
        WHERE org_id = ? AND more_section IS NOT NULL AND more_section <> ''
        ORDER BY more_section, title`,
    )
    .all(orgId) as Array<{ slug: string; title: string; description: string | null; moreSection: string }>;
}

/** The saved SQL for one block, scoped to the org. Used by view-mode filtering
 *  so a viewer can only re-run a block that already exists — never arbitrary SQL. */
export function getBuilderBlockSql(orgId: number, blockId: number): string | null {
  const row = getDb()
    .prepare("SELECT config FROM builder_blocks WHERE id = ? AND org_id = ?")
    .get(blockId, orgId) as { config: string } | undefined;
  if (!row) return null;
  return safeParse(row.config).sql ?? null;
}

/** A block's full config, org-scoped. Used by view-mode re-runs to dispatch to
 *  the right data path (SQL vs named source) with the viewer's filter params. */
export function getBuilderBlockConfig(orgId: number, blockId: number): BlockConfig | null {
  const row = getDb()
    .prepare("SELECT config FROM builder_blocks WHERE id = ? AND org_id = ?")
    .get(blockId, orgId) as { config: string } | undefined;
  return row ? safeParse(row.config) : null;
}

export function getBuilderBlocks(pageId: number): BuilderBlock[] {
  const rows = getDb()
    .prepare(
      `SELECT id, page_id AS pageId, position, kind, config
         FROM builder_blocks WHERE page_id = ? ORDER BY position ASC, id ASC`,
    )
    .all(pageId) as Array<{ id: number; pageId: number; position: number; kind: BlockKind; config: string }>;
  return rows.map((r) => ({
    id: r.id,
    pageId: r.pageId,
    position: r.position,
    kind: r.kind,
    config: safeParse(r.config),
  }));
}

function safeParse(s: string): BlockConfig {
  try {
    return JSON.parse(s) as BlockConfig;
  } catch {
    return {};
  }
}

export function createBuilderPage(orgId: number, title: string): string {
  const clean = title.trim() || "Untitled page";
  const base = slugify(clean);
  const db = getDb();
  let slug = base;
  for (let i = 2; ; i++) {
    const exists = db
      .prepare("SELECT 1 FROM builder_pages WHERE org_id = ? AND slug = ?")
      .get(orgId, slug);
    if (!exists) break;
    slug = `${base}-${i}`;
  }
  db.prepare("INSERT INTO builder_pages (org_id, slug, title) VALUES (?, ?, ?)").run(orgId, slug, clean);
  return slug;
}

export function updateBuilderPage(orgId: number, id: number, title: string, description: string | null, navSection?: string | null, moreSection?: string | null): void {
  const nav = navSection && NAV_SECTION_VALUES.has(navSection) ? navSection : null;
  const more = moreSection && moreSection.trim() ? moreSection.trim().slice(0, 40) : null;
  getDb()
    .prepare(
      `UPDATE builder_pages SET title = ?, description = ?, nav_section = ?, more_section = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND org_id = ?`,
    )
    .run(title.trim() || "Untitled page", description, nav, more, id, orgId);
}

export function deleteBuilderPage(orgId: number, id: number): void {
  getDb().prepare("DELETE FROM builder_pages WHERE id = ? AND org_id = ?").run(id, orgId);
}

function touchPage(pageId: number): void {
  getDb()
    .prepare("UPDATE builder_pages SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(pageId);
}

export function addBuilderBlock(orgId: number, pageId: number, kind: BlockKind): number {
  const db = getDb();
  const max = (db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM builder_blocks WHERE page_id = ?").get(pageId) as { m: number }).m;
  const info = db
    .prepare("INSERT INTO builder_blocks (page_id, org_id, position, kind, config) VALUES (?, ?, ?, ?, ?)")
    .run(pageId, orgId, max + 1, kind, JSON.stringify(DEFAULT_CONFIG[kind]));
  touchPage(pageId);
  return Number(info.lastInsertRowid);
}

export function updateBuilderBlock(orgId: number, id: number, config: BlockConfig): void {
  const db = getDb();
  const row = db.prepare("SELECT page_id AS pageId FROM builder_blocks WHERE id = ? AND org_id = ?").get(id, orgId) as { pageId: number } | undefined;
  if (!row) return;
  db.prepare("UPDATE builder_blocks SET config = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND org_id = ?")
    .run(JSON.stringify(config), id, orgId);
  touchPage(row.pageId);
}

export function deleteBuilderBlock(orgId: number, id: number): void {
  const db = getDb();
  const row = db.prepare("SELECT page_id AS pageId FROM builder_blocks WHERE id = ? AND org_id = ?").get(id, orgId) as { pageId: number } | undefined;
  db.prepare("DELETE FROM builder_blocks WHERE id = ? AND org_id = ?").run(id, orgId);
  if (row) touchPage(row.pageId);
}

// ─── Edit history (Undo) ─────────────────────────────────────────────

const MAX_PAGE_VERSIONS = 10;

interface PageSnapshot {
  page: { title: string; description: string | null; navSection: string | null; moreSection: string | null };
  blocks: Array<{ id: number; position: number; kind: string; config: string }>;
}

/** The page a block belongs to (org-scoped), or null. */
export function pageIdOfBlock(orgId: number, blockId: number): number | null {
  const row = getDb().prepare("SELECT page_id AS pid FROM builder_blocks WHERE id = ? AND org_id = ?").get(blockId, orgId) as { pid: number } | undefined;
  return row?.pid ?? null;
}

/** Snapshot a page (meta + blocks) so the next change can be undone. Call BEFORE
 *  mutating; keeps only the most recent MAX_PAGE_VERSIONS snapshots per page. */
export function snapshotPageVersion(orgId: number, pageId: number): void {
  const db = getDb();
  const page = db
    .prepare("SELECT title, description, nav_section AS navSection, more_section AS moreSection FROM builder_pages WHERE id = ? AND org_id = ?")
    .get(pageId, orgId) as PageSnapshot["page"] | undefined;
  if (!page) return;
  const blocks = db.prepare("SELECT id, position, kind, config FROM builder_blocks WHERE page_id = ? ORDER BY position, id").all(pageId) as PageSnapshot["blocks"];
  db.prepare("INSERT INTO builder_page_versions (page_id, org_id, snapshot) VALUES (?, ?, ?)").run(pageId, orgId, JSON.stringify({ page, blocks }));
  db.prepare(
    `DELETE FROM builder_page_versions
      WHERE page_id = ? AND id NOT IN (SELECT id FROM builder_page_versions WHERE page_id = ? ORDER BY id DESC LIMIT ?)`,
  ).run(pageId, pageId, MAX_PAGE_VERSIONS);
}

/** How many undo steps are available for a page. */
export function countPageVersions(orgId: number, pageId: number): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM builder_page_versions WHERE page_id = ? AND org_id = ?").get(pageId, orgId) as { n: number }).n;
}

/** Undo: restore the most recent snapshot (meta + blocks) and consume it, so
 *  repeated undos walk back through history. Block ids are preserved so filter
 *  targeting survives. Returns false when there's nothing to undo. */
export function undoPageVersion(orgId: number, pageId: number): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT id, snapshot FROM builder_page_versions WHERE page_id = ? AND org_id = ? ORDER BY id DESC LIMIT 1")
    .get(pageId, orgId) as { id: number; snapshot: string } | undefined;
  if (!row) return false;
  const snap = JSON.parse(row.snapshot) as PageSnapshot;
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE builder_pages SET title = ?, description = ?, nav_section = ?, more_section = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND org_id = ?",
    ).run(snap.page.title, snap.page.description, snap.page.navSection, snap.page.moreSection, pageId, orgId);
    db.prepare("DELETE FROM builder_blocks WHERE page_id = ?").run(pageId);
    const ins = db.prepare("INSERT INTO builder_blocks (id, page_id, org_id, position, kind, config) VALUES (?, ?, ?, ?, ?, ?)");
    for (const b of snap.blocks) ins.run(b.id, pageId, orgId, b.position, b.kind, b.config);
    db.prepare("DELETE FROM builder_page_versions WHERE id = ?").run(row.id);
  });
  tx();
  return true;
}

/** Swap a block with its neighbor in the given direction. */
export function moveBuilderBlock(orgId: number, id: number, dir: "up" | "down"): void {
  const db = getDb();
  const b = db.prepare("SELECT id, page_id AS pageId, position FROM builder_blocks WHERE id = ? AND org_id = ?").get(id, orgId) as
    | { id: number; pageId: number; position: number }
    | undefined;
  if (!b) return;
  const neighbor = db
    .prepare(
      dir === "up"
        ? "SELECT id, position FROM builder_blocks WHERE page_id = ? AND position < ? ORDER BY position DESC LIMIT 1"
        : "SELECT id, position FROM builder_blocks WHERE page_id = ? AND position > ? ORDER BY position ASC LIMIT 1",
    )
    .get(b.pageId, b.position) as { id: number; position: number } | undefined;
  if (!neighbor) return;
  const tx = db.transaction(() => {
    db.prepare("UPDATE builder_blocks SET position = ? WHERE id = ?").run(neighbor.position, b.id);
    db.prepare("UPDATE builder_blocks SET position = ? WHERE id = ?").run(b.position, neighbor.id);
  });
  tx();
  touchPage(b.pageId);
}
