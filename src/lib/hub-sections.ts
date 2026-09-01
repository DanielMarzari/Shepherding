import "server-only";
import { resolveNavConfig } from "./nav-config-db";
import { PAGE_REGISTRY } from "./nav-registry";
import { getMoreSections } from "./more-sections";
import type { GalleryLink, GallerySection } from "./gallery-types";

// Short descriptions for the main-nav pages (the See More pages carry their own
// rich descriptions via more-sections). Keyed by nav-registry pageKey.
const HUB_DESC: Record<string, string> = {
  "care-queue": "People flagged for follow-up — who needs a touch this week.",
  "shepherd-team": "The shepherd team and who each member is caring for.",
  shepherds: "Everyone who leads a group or team, and who oversees them.",
  people: "Search and browse every synced person, with their engagement.",
  groups: "Active groups, membership, health, and who's in them.",
  teams: "Serving teams, rosters, and who's serving lately.",
  checkins: "Check-in events and attendance from Planning Center.",
  "lanes-overview": "The next-steps pathway at a glance — who's in each lane.",
  "lanes-list": "Every lane with its people and recent movement.",
  "shepherd-map": "Who shepherds whom, mapped across the church.",
  "care-map": "Care assignments mapped across the congregation.",
  giving: "Giving from the PushPay import — coverage, stages, and funds.",
};

/** Sections for the home hub: the main-nav pages (from the org's nav config)
 *  followed by the See More sections — everything reachable from home. Skips
 *  Home itself, the See-More link (its contents are expanded here), and the
 *  Settings & Integration group (that lives in the top-right menu). */
export function buildHomeHubSections(orgId: number): GallerySection[] {
  const { config } = resolveNavConfig(orgId);
  const sections: GallerySection[] = [];
  const placed = new Set<string>(); // hrefs already sitting in a layer
  for (const g of config.groups) {
    if (g.id === "settings-integration") continue;
    const links: GalleryLink[] = [];
    for (const it of g.items) {
      if (it.kind === "page") {
        if (it.pageKey === "home" || it.pageKey === "more") continue;
        const def = PAGE_REGISTRY[it.pageKey];
        if (!def) continue;
        placed.add(def.href);
        links.push({ href: def.href, title: def.defaultLabel, description: HUB_DESC[it.pageKey] ?? "" });
      } else {
        placed.add(`/builder/${it.slug}`);
        links.push({ href: `/builder/${it.slug}`, title: it.label, description: "Custom page." });
      }
    }
    if (links.length) sections.push({ id: g.id, label: g.label, icon: g.icon, links });
  }
  // Append the See More sections, dropping any page the admin has already
  // placed into one of their own layers (so it isn't listed twice).
  const more = getMoreSections(orgId)
    .map((s) => ({ ...s, links: s.links.filter((l) => !placed.has(l.href)) }))
    .filter((s) => s.links.length > 0);
  return sections.concat(more);
}
