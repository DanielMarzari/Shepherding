import Link from "next/link";
import { resolveNavConfig } from "@/lib/nav-config-db";
import { PAGE_REGISTRY, type NavItemRef } from "@/lib/nav-registry";
import { NavIcon } from "./NavIcon";

// The rail that keeps navigation visible next to the page you're on. Home and
// Settings render the full GalleryHub instead (they ARE the hub); every other
// page gets this: the layer it belongs to, its sibling pages, and a way back.
//
// Deliberately NOT the old left sidebar — it shows only the current layer, not
// the whole app tree, so a page always sits beside its own siblings.

function keyOf(it: NavItemRef): string {
  return it.kind === "page" ? it.pageKey : `builder:${it.slug}`;
}
function hrefOf(it: NavItemRef): string | null {
  return it.kind === "page" ? PAGE_REGISTRY[it.pageKey]?.href ?? null : `/builder/${it.slug}`;
}
function labelOf(it: NavItemRef): string {
  return it.kind === "page" ? PAGE_REGISTRY[it.pageKey]?.defaultLabel ?? it.pageKey : it.label;
}

export async function NavRail({ active, orgId }: { active: string; orgId: number }) {
  const { config, activeToKey } = resolveNavConfig(orgId);
  const activeKey = activeToKey[active] ?? null;

  // The layer this page lives in. A page that isn't in the nav at all (or a
  // detail route whose parent isn't either) gets no rail — the page simply
  // renders full width rather than showing an unrelated layer.
  const group = config.groups.find((g) => g.items.some((it) => keyOf(it) === activeKey));
  if (!group) return null;

  const items = group.items
    .map((it) => ({ key: keyOf(it), href: hrefOf(it), label: labelOf(it) }))
    .filter((it): it is { key: string; href: string; label: string } => !!it.href);

  // A rail whose only entry is the page you're already on is pure chrome —
  // a whole column that navigates nowhere. This happens whenever a layer
  // holds a single page (e.g. Ministry Impact Reports, whose builder pages
  // are merged in at request time), so render nothing and let the page use
  // the full width.
  if (items.length < 2) return null;

  return (
    <nav
      aria-label={`${group.label} pages`}
      className="shrink-0 w-44 lg:w-52 border-r border-border-soft bg-bg-elev-2/30 py-4 hidden md:block"
    >
      <Link
        href="/"
        className="flex items-center gap-1.5 px-4 pb-3 text-xs text-muted hover:text-fg transition-colors"
      >
        <span aria-hidden>←</span> All pages
      </Link>
      <div className="px-4 pb-2 flex items-center gap-1.5">
        {group.icon && <NavIcon id={group.icon} size={14} className="text-muted" />}
        <span className="text-[0.7rem] uppercase tracking-wide font-semibold text-muted">
          {group.label}
        </span>
      </div>
      <ul className="space-y-0.5 px-2">
        {items.map((it) => {
          const isActive = it.key === activeKey;
          return (
            <li key={it.key}>
              <Link
                href={it.href}
                aria-current={isActive ? "page" : undefined}
                className={`block rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-accent-soft-bg text-accent-soft-fg font-medium"
                    : "text-muted hover:text-fg hover:bg-bg-elev-2/60"
                }`}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
