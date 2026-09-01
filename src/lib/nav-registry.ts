// Source of truth for the configurable sidebar. Two halves:
//   1. PAGE_REGISTRY — every nav-worthy destination, keyed by a stable
//      pageKey, with the `active=` strings each page passes today mapped to
//      that key. Highlighting resolves by key, NOT by label, so an admin can
//      rename a heading/label without breaking which row lights up.
//   2. DEFAULT_NAV_CONFIG — the seeded default layout (used until an org edits
//      it), which reproduces a usable sidebar and folds every credential /
//      filters / metrics / appearance page into one "Settings & Integration"
//      drill-in group.
// Pure data + validation — safe to import from both server and client.

export interface PageDef {
  href: string;
  defaultLabel: string;
  /** Every `active=` string a page passes that should light this key. */
  activeAliases: string[];
  badge?: number;
}

/** Keyed by pageKey. Detail routes (e.g. /people/[slug]) reuse their parent's
 *  key via that page passing the parent's `active` string, so they don't need
 *  their own entry. */
export const PAGE_REGISTRY: Record<string, PageDef> = {
  home: { href: "/", defaultLabel: "Home", activeAliases: ["Home"] },
  "care-queue": { href: "/care-queue", defaultLabel: "Care queue", activeAliases: ["Care queue"], badge: 17 },
  "shepherd-team": { href: "/shepherd-team", defaultLabel: "Shepherd team", activeAliases: ["Shepherd team"] },
  shepherds: { href: "/shepherds", defaultLabel: "Shepherds", activeAliases: ["Shepherds"] },
  people: { href: "/people", defaultLabel: "People", activeAliases: ["People"] },
  groups: { href: "/groups", defaultLabel: "Groups", activeAliases: ["Groups"] },
  teams: { href: "/teams", defaultLabel: "Teams", activeAliases: ["Teams"] },
  checkins: { href: "/checkins", defaultLabel: "Check-ins", activeAliases: ["Check-ins"] },
  "lanes-overview": { href: "/lanes", defaultLabel: "Activity overview", activeAliases: ["Activity overview", "Activity / Lanes"] },
  "lanes-list": { href: "/lanes/list", defaultLabel: "Lanes", activeAliases: ["Lanes"] },
  more: { href: "/more", defaultLabel: "See more", activeAliases: ["See more"] },
  "shepherd-map": { href: "/shepherd-map", defaultLabel: "Shepherd map", activeAliases: ["Shepherd map"] },
  "care-map": { href: "/care-map", defaultLabel: "Care map", activeAliases: ["Care map"] },
  // Settings & Integration members
  pco: { href: "/pco", defaultLabel: "PCO", activeAliases: ["PCO"] },
  pushpay: { href: "/pushpay", defaultLabel: "PushPay", activeAliases: ["PushPay"] },
  "constant-contact": { href: "/constant-contact", defaultLabel: "Constant Contact", activeAliases: ["Constant Contact"] },
  subsplash: { href: "/subsplash", defaultLabel: "Subsplash", activeAliases: ["Subsplash"] },
  filters: { href: "/pco/filters", defaultLabel: "Filters", activeAliases: ["Filters"] },
  metrics: { href: "/metrics", defaultLabel: "Metrics", activeAliases: ["Metrics"] },
  appearance: { href: "/settings/appearance", defaultLabel: "Appearance", activeAliases: ["Appearance"] },
  performance: { href: "/settings/performance", defaultLabel: "Performance", activeAliases: ["Performance"] },
  navigation: { href: "/settings/navigation", defaultLabel: "Navigation", activeAliases: ["Navigation"] },

  // Utility / report / audit pages. Not in the default layout, but addable to
  // any layer via the nav builder (they otherwise live on the See More hub).
  "audit-membership": { href: "/audit", defaultLabel: "Membership audit", activeAliases: ["Membership audit"] },
  "audit-duplicates": { href: "/audit/duplicates", defaultLabel: "Duplicate audit", activeAliases: ["Duplicate audit"] },
  "audit-names": { href: "/audit/names", defaultLabel: "Name audit", activeAliases: ["Name audit"] },
  "audit-pushpay": { href: "/audit/pushpay", defaultLabel: "PushPay connections", activeAliases: ["PushPay connections"] },
  demographics: { href: "/demographics", defaultLabel: "Membership demographics", activeAliases: ["Membership demographics"] },
  attendance: { href: "/attendance", defaultLabel: "Attendance", activeAliases: ["Attendance"] },
  pipeline: { href: "/pipeline", defaultLabel: "Pipeline", activeAliases: ["Pipeline"] },
  mir: { href: "/mir", defaultLabel: "Ministry Impact Reports", activeAliases: ["Ministry Impact Reports"] },
  graph: { href: "/graph", defaultLabel: "Relationship graph", activeAliases: ["Relationship graph"] },
  "intake-graph": { href: "/intake-graph", defaultLabel: "Who knows who", activeAliases: ["Who knows who"] },
  retention: { href: "/retention", defaultLabel: "Retention", activeAliases: ["Retention"] },
  map: { href: "/map", defaultLabel: "Member map", activeAliases: ["Member map"] },
  "reaching-the-valley": { href: "/reaching-the-valley", defaultLabel: "Reaching the Lehigh Valley", activeAliases: ["Reaching the Lehigh Valley"] },
  "next-campus-planner": { href: "/next-campus-planner", defaultLabel: "Next campus planner", activeAliases: ["Next campus planner"] },
  "email-dashboard": { href: "/constant-contact/dashboard", defaultLabel: "Email dashboard", activeAliases: ["Constant Contact dashboard", "Email dashboard"] },
  builder: { href: "/builder", defaultLabel: "Page Builder", activeAliases: ["Page Builder"] },
  examples: { href: "/examples", defaultLabel: "Design references", activeAliases: ["Design references"] },
  movement: { href: "/movement", defaultLabel: "Movement", activeAliases: ["Movement"] },
  staff: { href: "/staff", defaultLabel: "Staff", activeAliases: ["Staff"] },
  giving: { href: "/giving", defaultLabel: "Giving statistics", activeAliases: ["Giving statistics"] },
};

/** Reverse index: an incoming `active=` string → pageKey, O(1). */
export const ACTIVE_TO_KEY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [key, def] of Object.entries(PAGE_REGISTRY)) {
    for (const alias of def.activeAliases) m[alias] = key;
  }
  return m;
})();

export type NavMode = "top" | "drill";
export type NavItemRef =
  | { kind: "page"; pageKey: string }
  | { kind: "builder"; slug: string; label: string };
export interface NavGroup {
  id: string;
  label: string;
  mode: NavMode;
  collapsible?: boolean;
  items: NavItemRef[];
}
export interface NavConfig {
  version: 1;
  groups: NavGroup[];
}

const P = (pageKey: string): NavItemRef => ({ kind: "page", pageKey });

/** The seeded default — a usable sidebar with credentials + filters + metrics
 *  + appearance + performance consolidated into one drill-in group. */
export const DEFAULT_NAV_CONFIG: NavConfig = {
  version: 1,
  groups: [
    { id: "dashboard", label: "Dashboard", mode: "top", items: [P("home"), P("care-queue")] },
    { id: "leadership", label: "Leadership", mode: "top", items: [P("shepherd-team"), P("shepherds")] },
    { id: "pco", label: "PCO data", mode: "top", collapsible: true, items: [P("people"), P("groups"), P("teams"), P("checkins")] },
    { id: "next-steps", label: "Next steps", mode: "top", items: [P("lanes-overview"), P("lanes-list")] },
    { id: "mappings", label: "Maps", mode: "top", collapsible: true, items: [P("shepherd-map"), P("care-map")] },
    { id: "more", label: "More", mode: "top", items: [P("more")] },
    {
      id: "settings-integration",
      label: "Settings & Integration",
      mode: "drill",
      items: [P("pco"), P("pushpay"), P("constant-contact"), P("subsplash"), P("filters"), P("metrics"), P("appearance"), P("performance"), P("navigation")],
    },
  ],
};

/** Coerce arbitrary parsed JSON into a valid NavConfig, dropping anything
 *  unrecognized so a corrupt/hand-edited row can never blank the nav. Returns
 *  null when it's too far gone to salvage (caller falls back to the default). */
export function sanitizeNavConfig(raw: unknown): NavConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { groups?: unknown };
  if (!Array.isArray(obj.groups)) return null;
  const groups: NavGroup[] = [];
  const seenGroup = new Set<string>();
  for (const g of obj.groups) {
    if (!g || typeof g !== "object") continue;
    const gg = g as Partial<NavGroup> & { id?: unknown; label?: unknown; items?: unknown };
    const id = typeof gg.id === "string" && gg.id.trim() ? gg.id.trim() : null;
    const label = typeof gg.label === "string" && gg.label.trim() ? gg.label.trim() : null;
    if (!id || !label || seenGroup.has(id)) continue;
    const mode: NavMode = gg.mode === "drill" ? "drill" : "top";
    const items: NavItemRef[] = [];
    const seenItem = new Set<string>();
    if (Array.isArray(gg.items)) {
      for (const it of gg.items) {
        if (!it || typeof it !== "object") continue;
        const ii = it as { kind?: unknown; pageKey?: unknown; slug?: unknown; label?: unknown };
        if (ii.kind === "page" && typeof ii.pageKey === "string" && PAGE_REGISTRY[ii.pageKey]) {
          if (seenItem.has("p:" + ii.pageKey)) continue;
          seenItem.add("p:" + ii.pageKey);
          items.push({ kind: "page", pageKey: ii.pageKey });
        } else if (ii.kind === "builder" && typeof ii.slug === "string" && ii.slug.trim()) {
          if (seenItem.has("b:" + ii.slug)) continue;
          seenItem.add("b:" + ii.slug);
          items.push({ kind: "builder", slug: ii.slug.trim(), label: typeof ii.label === "string" ? ii.label : ii.slug });
        }
      }
    }
    groups.push({ id, label, mode, collapsible: gg.collapsible === true, items });
  }
  if (groups.length === 0) return null;
  return { version: 1, groups };
}
