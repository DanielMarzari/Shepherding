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
  | "text"
  | "divider"
  | "embed"
  | "filter"
  | "pagelist"
  | "group";

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
  filterType?: "dropdown" | "chips" | "date" | "text";
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
  /** Stat display: a plain number, or a normalized ratio across the row's numbers (1 : 3 : 5). */
  format?: "number" | "ratio";
  /** Per-table-column preset text color, keyed by column name (a "parts" override). */
  columnColors?: Record<string, string>;
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
