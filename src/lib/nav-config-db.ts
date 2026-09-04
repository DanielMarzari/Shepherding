import "server-only";
import { getDb } from "./db";
import { listMorePages, listNavPages } from "./builder";
import { BUILDER_SEEDS } from "./builder-seeds";
import {
  DEFAULT_NAV_CONFIG,
  PAGE_REGISTRY,
  migrateNavConfig,
  sanitizeNavConfig,
  type NavConfig,
  type NavGroup,
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
/** Registry pages the app keeps in a layer even for an org whose nav was saved
 *  before the page existed. Faith Church customised its nav long ago, so a new
 *  integration added only to DEFAULT_NAV_CONFIG would be reachable by URL and
 *  invisible everywhere else. Only ever ADDS a missing page to a group that
 *  already exists — it never reorders, renames, or removes what an admin set,
 *  and it stays quiet if they deliberately deleted the group.
 *
 *  KNOWN LIMIT: removing the page itself (rather than the group) does not stick
 *  — nothing distinguishes "deliberately removed" from "never had it", so it
 *  reappears on the next render. Making that stick needs the removal persisted
 *  (a dismissed-pages list on nav_config); not worth the machinery until
 *  somebody actually wants one of these gone. */
const MANAGED_PAGES: Record<string, string> = {
  spotify: "settings-integration",
};

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

/** The org's config with every builder page merged into a real group, plus the
 *  active→key map. Deep-clones first so the shared DEFAULT_NAV_CONFIG constant
 *  is never mutated across requests.
 *
 *  This is what BOTH the hub and the Nav Builder read. They must not diverge:
 *  a layer or page that renders on the hub but is missing from the editor is a
 *  layer the admin cannot touch. */
export function resolveNavConfig(orgId: number): ResolvedNav {
  const config: NavConfig = structuredClone(getNavConfig(orgId));
  const activeToKey: Record<string, string> = {};
  for (const [key, def] of Object.entries(PAGE_REGISTRY)) {
    for (const a of def.activeAliases) activeToKey[a] = key;
  }

  const groupById = new Map(config.groups.map((g) => [g.id, g]));
  const norm = (s: string) => s.trim().toLowerCase();
  const groupByLabel = new Map(config.groups.map((g) => [norm(g.label), g]));
  /** Every builder slug already sitting somewhere in the config. The check has
   *  to be config-wide, not per-group: once an admin drags a merged page into a
   *  layer of their own, a per-group check would happily re-add it to the group
   *  its seed names and the page would show up twice. */
  const placed = new Set(
    config.groups.flatMap((g) => g.items.filter((it) => it.kind === "builder").map((it) => it.slug)),
  );
  /** Groups this call invented. They exist only in memory and were never
   *  arranged by an admin, so they are safe to sort; a group the admin ordered
   *  by hand is left exactly as they left it. */
  const invented = new Set<string>();

  /** The group a merged page belongs in — reusing the admin's own layer when
   *  they already made one by that name. Matching on id alone would sit a
   *  second "Ministry Impact Reports" next to theirs, same heading twice. */
  function groupFor(id: string, label: string, icon?: string, mode: "top" | "drill" = "top") {
    const existing = groupById.get(id) ?? groupByLabel.get(norm(label));
    if (existing) {
      groupById.set(id, existing);
      return existing;
    }
    const g: NavGroup = { id, label, mode, icon, items: [] };
    config.groups.push(g);
    groupById.set(id, g);
    groupByLabel.set(norm(label), g);
    invented.add(g.id);
    return g;
  }

  const attach = (g: NavGroup, slug: string, label: string) => {
    if (placed.has(slug)) return;
    placed.add(slug);
    g.items.push({ kind: "builder", slug, label });
    activeToKey[label] = `builder:${slug}`;
  };

  // A builder page only lands in `builder_pages` when somebody first opens its
  // route, so listing the nav from the database alone means a page nobody has
  // visited yet is invisible — and a page you can't see is a page you can't
  // visit, which is a deadlock. The seeded definitions are therefore merged in:
  // the nav shows every page that COULD exist, and opening one creates it
  // (see `/builder/[slug]`, which seeds). A row in the database always wins, so
  // a page an admin has renamed or re-filed keeps their version.
  const dbNav = listNavPages(orgId) as Array<{ slug: string; title: string; navSection: string | null }>;
  const dbMore = listMorePages(orgId) as Array<{ slug: string; title: string; moreSection: string }>;
  const known = new Set([...dbNav, ...dbMore].map((p) => p.slug));
  const seeds = Object.values(BUILDER_SEEDS).filter((s) => !known.has(s.slug));

  for (const p of [
    ...dbNav,
    ...seeds.filter((s) => s.navSection).map((s) => ({ slug: s.slug, title: s.title, navSection: s.navSection ?? null })),
  ]) {
    const gid = SECTION_TO_GROUP[p.navSection ?? ""] ?? p.navSection ?? "";
    const managed = MANAGED_GROUPS[gid];
    const g = groupById.get(gid) ?? (managed ? groupFor(gid, managed.label, managed.icon, managed.mode) : null);
    if (!g) continue;
    attach(g, p.slug, p.title);
  }

  // Pages filed under a free-text "See more" heading. The heading becomes a
  // real layer rather than a section conjured at render time — otherwise it
  // shows on the hub and the Nav Builder has nothing to edit.
  for (const p of [
    ...dbMore,
    ...seeds.filter((s) => s.moreSection).map((s) => ({ slug: s.slug, title: s.title, moreSection: s.moreSection as string })),
  ]) {
    const label = p.moreSection.trim();
    if (!label) continue;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "more-pages";
    attach(groupFor(id, label), p.slug, p.title);
  }

  // Config-WIDE, not per-group: an admin who drags Spotify out of Integrations
  // into a layer of their own would otherwise get it re-added to Integrations
  // too, and see it twice. Same reasoning as the `placed` set above.
  const placedPages = new Set(
    config.groups.flatMap((g) =>
      g.items.filter((it) => it.kind === "page").map((it) => it.pageKey),
    ),
  );
  for (const [pageKey, gid] of Object.entries(MANAGED_PAGES)) {
    if (placedPages.has(pageKey)) continue;
    const g = groupById.get(gid);
    if (!g) continue; // the admin removed the group; respect that
    g.items.push({ kind: "page", pageKey });
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
