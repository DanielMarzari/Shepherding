import "server-only";
import { getDb } from "./db";
import { listNavPages } from "./builder";
import {
  DEFAULT_NAV_CONFIG,
  PAGE_REGISTRY,
  sanitizeNavConfig,
  type NavConfig,
} from "./nav-registry";

// Legacy builder nav_section keys → the new group ids. "settings" folds into
// the consolidated Settings & Integration group; the rest keep their id.
const SECTION_TO_GROUP: Record<string, string> = {
  dashboard: "dashboard",
  leadership: "leadership",
  pco: "pco",
  "next-steps": "next-steps",
  mappings: "mappings",
  settings: "settings-integration",
  more: "more",
};

export function getNavConfig(orgId: number): NavConfig {
  const row = getDb()
    .prepare(`SELECT config FROM nav_config WHERE org_id = ?`)
    .get(orgId) as { config: string } | undefined;
  if (!row) return DEFAULT_NAV_CONFIG;
  try {
    return sanitizeNavConfig(JSON.parse(row.config)) ?? DEFAULT_NAV_CONFIG;
  } catch {
    return DEFAULT_NAV_CONFIG;
  }
}

/** Validate + persist. Returns the cleaned config actually stored. */
export function saveNavConfig(orgId: number, raw: unknown): NavConfig {
  const clean = sanitizeNavConfig(raw) ?? DEFAULT_NAV_CONFIG;
  getDb()
    .prepare(
      `INSERT INTO nav_config (org_id, config, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(org_id) DO UPDATE SET config=excluded.config, updated_at=excluded.updated_at`,
    )
    .run(orgId, JSON.stringify(clean));
  return clean;
}

export interface ResolvedNav {
  config: NavConfig;
  /** `active=` string → item key (pageKey, or `builder:<slug>`). */
  activeToKey: Record<string, string>;
}

/** The org's config with builder-pinned pages merged into their groups, plus
 *  the active→key map (including builder page titles). Deep-clones first so the
 *  shared DEFAULT_NAV_CONFIG constant is never mutated across requests. */
export function resolveNavConfig(orgId: number): ResolvedNav {
  const config: NavConfig = structuredClone(getNavConfig(orgId));
  const activeToKey: Record<string, string> = {};
  for (const [key, def] of Object.entries(PAGE_REGISTRY)) {
    for (const a of def.activeAliases) activeToKey[a] = key;
  }

  const navPages = listNavPages(orgId) as Array<{ slug: string; title: string; navSection: string | null }>;
  const groupById = new Map(config.groups.map((g) => [g.id, g]));
  for (const p of navPages) {
    const gid = SECTION_TO_GROUP[p.navSection ?? ""] ?? p.navSection ?? "";
    const g = groupById.get(gid);
    if (!g) continue;
    if (g.items.some((it) => it.kind === "builder" && it.slug === p.slug)) continue;
    g.items.push({ kind: "builder", slug: p.slug, label: p.title });
    activeToKey[p.title] = `builder:${p.slug}`;
  }
  return { config, activeToKey };
}

// ─── Per-user pins (See More / Settings gallery favorites) ────────────
// Keyed by a stable string — the page's href — so a pin survives renames and
// works for registry pages, builder pages, and hand-coded pages alike.

export function getPinnedKeys(orgId: number, userId: number): string[] {
  return (
    getDb()
      .prepare(`SELECT page_key FROM nav_pins WHERE org_id = ? AND user_id = ? ORDER BY position, pinned_at`)
      .all(orgId, userId) as Array<{ page_key: string }>
  ).map((r) => r.page_key);
}

/** Toggle a pin; returns the new pinned state (true = now pinned). */
export function togglePin(orgId: number, userId: number, key: string): boolean {
  const db = getDb();
  const exists = db
    .prepare(`SELECT 1 FROM nav_pins WHERE org_id = ? AND user_id = ? AND page_key = ?`)
    .get(orgId, userId, key);
  if (exists) {
    db.prepare(`DELETE FROM nav_pins WHERE org_id = ? AND user_id = ? AND page_key = ?`).run(orgId, userId, key);
    return false;
  }
  const max = (
    db.prepare(`SELECT COALESCE(MAX(position), -1) AS m FROM nav_pins WHERE org_id = ? AND user_id = ?`).get(orgId, userId) as { m: number }
  ).m;
  db.prepare(`INSERT INTO nav_pins (org_id, user_id, page_key, position) VALUES (?, ?, ?, ?)`).run(orgId, userId, key, max + 1);
  return true;
}
