import "server-only";
import { resolveNavConfig } from "./nav-config-db";
import { PAGE_REGISTRY } from "./nav-registry";
import { listMorePages, listNavPages } from "./builder";
import { BUILDER_SEEDS } from "./builder-seeds";
import type { GalleryLink, GallerySection } from "./gallery-types";

/** Every layer of the hub, built from the org's nav config — the one thing
 *  /settings/navigation edits, so everything on the hub is editable there.
 *
 *  The audit / reports / email / internal layers used to be a hardcoded array
 *  in more-sections.ts appended after the configured layers. They rendered on
 *  the hub but were invisible to the editor, so there was no way to rename,
 *  reorder, re-icon or remove them. They're seeded groups now — see
 *  DEFAULT_NAV_CONFIG and migrateNavConfig, which folds them into a layout
 *  that was saved before they existed.
 *
 *  Skips Home itself, the See-More link (its contents ARE these layers), and
 *  the Settings & Integration group, which lives in the top-right menu. */
export function buildHubSections(orgId: number): GallerySection[] {
  const { config } = resolveNavConfig(orgId);

  // What a builder page is actually about. Without this every card in a layer
  // reads "Custom page.", which is no help at all when a layer holds forty
  // ministry reports. A saved page's own description wins; a page nobody has
  // opened yet falls back to its seed definition, so the card is useful before
  // the page exists.
  const describe = new Map<string, string>();
  for (const s of Object.values(BUILDER_SEEDS)) {
    if (s.description) describe.set(s.slug, s.description);
  }
  for (const p of listNavPages(orgId)) {
    const d = (p.description ?? "").trim();
    if (d) describe.set(p.slug, d);
  }

  // Builder pages the admin filed under a free-text heading rather than a
  // layer id. Matched to a layer by label so existing placements survive.
  const byHeading = new Map<string, { label: string; links: GalleryLink[] }>();
  for (const p of listMorePages(orgId)) {
    const label = p.moreSection.trim();
    const key = label.toLowerCase();
    const link: GalleryLink = {
      href: `/builder/${p.slug}`,
      title: p.title,
      description: p.description ?? "Custom page.",
    };
    (byHeading.get(key) ?? byHeading.set(key, { label, links: [] }).get(key)!).links.push(link);
  }

  const sections: GallerySection[] = [];
  for (const g of config.groups) {
    if (g.id === "settings-integration") continue;
    const links: GalleryLink[] = [];
    const seen = new Set<string>();
    const add = (l: GalleryLink) => {
      if (seen.has(l.href)) return;
      seen.add(l.href);
      links.push(l);
    };
    for (const it of g.items) {
      if (it.kind === "page") {
        if (it.pageKey === "home" || it.pageKey === "more") continue;
        const def = PAGE_REGISTRY[it.pageKey];
        if (!def) continue;
        add({
          href: def.href,
          title: def.defaultLabel,
          description: def.description ?? "",
          ...(def.external ? { external: true } : {}),
        });
      } else {
        add({
          href: `/builder/${it.slug}`,
          title: it.label,
          description: describe.get(it.slug) ?? "Custom page.",
        });
      }
    }
    const heading = g.label.trim().toLowerCase();
    for (const l of byHeading.get(heading)?.links ?? []) add(l);
    byHeading.delete(heading);
    if (links.length) {
      sections.push({ id: g.id, label: g.label, icon: g.icon, blurb: g.blurb, links });
    }
  }

  // A builder heading matching no layer still gets a section of its own, so a
  // page can't fall off the hub just because a layer was renamed.
  for (const [key, { label, links }] of byHeading) {
    sections.push({ id: `heading-${key.replace(/[^a-z0-9]+/g, "-")}`, label, links });
  }
  return sections;
}
