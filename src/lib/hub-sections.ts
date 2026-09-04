import "server-only";
import { resolveNavConfig } from "./nav-config-db";
import { PAGE_REGISTRY, type NavSurface } from "./nav-registry";
import { listNavPages } from "./builder";
import { BUILDER_SEEDS } from "./builder-seeds";
import type { GalleryLink, GallerySection } from "./gallery-types";

/** Every layer of the hub, built from the org's nav config — the one thing
 *  /settings/navigation edits, so everything on the hub is editable there.
 *
 *  EVERY section here comes from a NavGroup, with no exceptions — a section
 *  conjured at render time is a section the Nav Builder cannot edit. Builder
 *  pages filed under a free-text "See more" heading used to be exactly that;
 *  resolveNavConfig now turns the heading into a real group instead.
 *
 *  Every item an admin places becomes a card — including Home and See more.
 *  Skipping those two meant the default "More" layer (whose only page IS See
 *  more) showed in the Nav Builder and rendered nowhere, and a Dashboard layer
 *  of two pages drew one card. The editor is supposed to look like the result.
 *  A layer marked surface:"settings" renders on /settings instead — held back
 *  from the hub, never dropped, and edited in the same Nav Builder. */
export function buildHubSections(orgId: number): GallerySection[] {
  return sectionsFor(orgId, "hub");
}

/** The layers that render on /settings, reached from the top-right menu. Same
 *  config, same Nav Builder — just a different surface. */
export function buildSettingsSections(orgId: number): GallerySection[] {
  return sectionsFor(orgId, "settings");
}

function sectionsFor(orgId: number, surface: NavSurface): GallerySection[] {
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

  const sections: GallerySection[] = [];
  for (const g of config.groups) {
    if ((g.surface ?? "hub") !== surface) continue;
    const links: GalleryLink[] = [];
    const seen = new Set<string>();
    const add = (l: GalleryLink) => {
      if (seen.has(l.href)) return;
      seen.add(l.href);
      links.push(l);
    };
    for (const it of g.items) {
      if (it.kind === "page") {
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
    if (links.length) {
      sections.push({ id: g.id, label: g.label, icon: g.icon, blurb: g.blurb, links });
    }
  }
  return sections;
}
