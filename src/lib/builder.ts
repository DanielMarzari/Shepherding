import "server-only";
import Database from "better-sqlite3";
import { getDb } from "./db";

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
  /\b(attach|detach|pragma|insert|update|delete|drop|alter|create|replace|vacuum|reindex|begin|commit|rollback|savepoint|release)\b/i;
const MAX_ROWS = 1000;

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  error?: string;
}

/** Run a single read-only SELECT/WITH statement, capped at MAX_ROWS. */
export function runBuilderQuery(sql: string): QueryResult {
  const empty = (error: string): QueryResult => ({ columns: [], rows: [], truncated: false, error });
  const q = (sql ?? "").trim().replace(/;+\s*$/, "");
  if (!q) return empty("Write a SELECT query to power this block.");
  if (q.includes(";")) return empty("Only a single statement is allowed (no semicolons).");
  if (!/^(select|with)\b/i.test(q)) return empty("Only SELECT / WITH queries are allowed here.");
  if (FORBIDDEN.test(q)) return empty("That query uses a keyword that isn’t allowed (read-only).");
  try {
    const stmt = roDb().prepare(q);
    const columns = stmt.columns().map((c) => c.name);
    const all = stmt.raw(true).all() as unknown[][];
    return { columns, rows: all.slice(0, MAX_ROWS), truncated: all.length > MAX_ROWS };
  } catch (e) {
    return empty(e instanceof Error ? e.message : "Query failed.");
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
    try {
      columns[t] = (ro.prepare(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).all() as Array<{ name: string }>).map((c) => c.name);
    } catch {
      columns[t] = [];
    }
  }
  return { tables, columns };
}

// ─── Page + block model ──────────────────────────────────────────────

export type BlockKind = "stat" | "table" | "chart" | "text";

export interface BuilderPage {
  id: number;
  slug: string;
  title: string;
  description: string | null;
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
  /** Bento column span (1–6). */
  span?: number;
  [k: string]: unknown;
}

export const DEFAULT_CONFIG: Record<BlockKind, BlockConfig> = {
  stat: {
    title: "New stat",
    sql: "SELECT COUNT(*) FROM pco_people",
    sub: "the value is the first column of the first row",
    span: 1,
  },
  chart: {
    title: "New chart",
    sql: "SELECT classification AS label, COUNT(*) AS value\nFROM person_activity\nGROUP BY classification\nORDER BY value DESC",
    chartType: "bar",
    span: 3,
  },
  table: {
    title: "New table",
    sql: "SELECT classification, COUNT(*) AS people\nFROM person_activity\nGROUP BY classification\nORDER BY people DESC",
    span: 3,
  },
  text: {
    title: "",
    text: "Write notes here. This block has no query — it’s just text.",
    span: 3,
  },
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "page";
}

export function listBuilderPages(orgId: number): BuilderPage[] {
  return getDb()
    .prepare(
      `SELECT p.id, p.slug, p.title, p.description, p.updated_at AS updatedAt,
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
      `SELECT id, slug, title, description, updated_at AS updatedAt
         FROM builder_pages WHERE org_id = ? AND slug = ?`,
    )
    .get(orgId, slug) as Omit<BuilderPage, "blockCount"> | undefined;
  return row ? { ...row, blockCount: 0 } : null;
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

export function updateBuilderPage(orgId: number, id: number, title: string, description: string | null): void {
  getDb()
    .prepare(
      `UPDATE builder_pages SET title = ?, description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND org_id = ?`,
    )
    .run(title.trim() || "Untitled page", description, id, orgId);
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
