import "server-only";
import { getDb } from "./db";
import { listNavPages } from "./builder";
import { BUILDER_SEEDS } from "./builder-seeds";
import {
  DEFAULT_NAV_CONFIG,
  PAGE_REGISTRY,
  migrateNavConfig,
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
  "ministry-impact-reports": "ministry-impact-reports",
};

/** Groups the app creates on demand rather than expecting to find in the org's
 *  saved nav. An org that customized its nav before these existed (Faith Church
 *  did) would otherwise have builder pages pointing at a group id that isn't
 *  there, and `resolveNavConfig` would silently drop them. Creating the folder
 *  the first time a page targets it means a new ministry report just appears,
 *  with no nav surgery and no overwrite of the admin's own layout. Only ever
 *  ADDs a group — never reorders or edits what the admin arranged. */
const MANAGED_GROUPS: Record<string, { label: string; icon?: string; mode: "top" | "drill" }> = {
  "ministry-impact-reports": {
    label: "Ministry Impact Reports",
    icon: "target",
    mode: "drill",
  },
};

export function getNavConfig(orgId: number): NavConfig {
  const row = getDb()
    .prepare(`SELECT config FROM nav_config WHERE org_id = ?`)
    .get(orgId) as { config: string } | undefined;
  if (!row) return DEFAULT_NAV_CONFIG;
  let stored: NavConfig | null = null;
  try {
    stored = sanitizeNavConfig(JSON.parse(row.config));
  } catch {
    stored = null;
  }
  if (!stored) return DEFAULT_NAV_CONFIG;
  // An org that saved a layout before a new default layer existed would never
  // see that layer. Fold it in for the caller — in memory only, like
  // MANAGED_GROUPS below: a read has no business rewriting the admin's saved
  // layout. The editor stamps the current version on its next save, which is
  // what stops this from re-adding a layer the admin has since deleted.
  return migrateNavConfig(stored).config;
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

  // A builder page only lands in `builder_pages` when somebody first opens its
  // route, so listing the nav from the database alone means a page nobody has
  // visited yet is invisible — and a page you can't see is a page you can't
  // visit, which is a deadlock. The seeded definitions are therefore merged in:
  // the nav shows every page that COULD exist, and opening one creates it
  // (see `/builder/[slug]`, which seeds). A row in the database always wins, so
  // a page an admin has renamed or re-filed keeps their version.
  const fromDb = listNavPages(orgId) as Array<{ slug: string; title: string; navSection: string | null }>;
  const seen = new Set(fromDb.map((p) => p.slug));
  const fromSeeds = Object.values(BUILDER_SEEDS)
    .filter((s) => s.navSection && !seen.has(s.slug))
    .map((s) => ({ slug: s.slug, title: s.title, navSection: s.navSection ?? null }));
  const navPages = [...fromDb, ...fromSeeds];

  const groupById = new Map(config.groups.map((g) => [g.id, g]));
  /** Groups this call invented (see MANAGED_GROUPS). They exist only in memory
   *  and were never arranged by an admin, so they are safe to sort; a group the
   *  admin ordered by hand is left exactly as they left it. */
  const invented = new Set<string>();
  for (const p of navPages) {
    const gid = SECTION_TO_GROUP[p.navSection ?? ""] ?? p.navSection ?? "";
    let g = groupById.get(gid);
    if (!g) {
      const managed = MANAGED_GROUPS[gid];
      if (!managed) continue;
      g = { id: gid, label: managed.label, mode: managed.mode, icon: managed.icon, items: [] };
      config.groups.push(g);
      groupById.set(gid, g);
      invented.add(gid);
    }
    if (g.items.some((it) => it.kind === "builder" && it.slug === p.slug)) continue;
    g.items.push({ kind: "builder", slug: p.slug, label: p.title });
    activeToKey[p.title] = `builder:${p.slug}`;
  }

  // Forty ministry reports in database-then-seed order would read as noise.
  for (const gid of invented) {
    groupById.get(gid)?.items.sort((a, b) =>
      (a.kind === "builder" ? a.label : a.pageKey).localeCompare(
        b.kind === "builder" ? b.label : b.pageKey,
      ),
    );
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
