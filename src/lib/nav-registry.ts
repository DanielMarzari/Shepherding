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
  /** Card copy on the hub. Lives here so ONE registry entry is all a new page
   *  needs to be navigable, describable and assignable to a layer. */
  description?: string;
  /** Leaves the app (opens in a new tab). */
  external?: boolean;
  badge?: number;
}

/** Keyed by pageKey. Detail routes (e.g. /people/[slug]) reuse their parent's
 *  key via that page passing the parent's `active` string, so they don't need
 *  their own entry. */
export const PAGE_REGISTRY: Record<string, PageDef> = {
  home: { href: "/", defaultLabel: "Home", activeAliases: ["Home"], description: "Dashboard widgets and every layer of the hub." },
  "care-queue": { href: "/care-queue", defaultLabel: "Care queue", activeAliases: ["Care queue"], badge: 17, description: "People flagged for follow-up — who needs a touch this week." },
  "shepherd-team": { href: "/shepherd-team", defaultLabel: "Shepherd team", activeAliases: ["Shepherd team"], description: "The shepherd team and who each member is caring for." },
  shepherds: { href: "/shepherds", defaultLabel: "Shepherds", activeAliases: ["Shepherds"], description: "Everyone who leads a group or team, and who oversees them." },
  people: { href: "/people", defaultLabel: "People", activeAliases: ["People"], description: "Search and browse every synced person, with their engagement." },
  groups: { href: "/groups", defaultLabel: "Groups", activeAliases: ["Groups"], description: "Active groups, membership, health, and who's in them." },
  teams: { href: "/teams", defaultLabel: "Teams", activeAliases: ["Teams"], description: "Serving teams, rosters, and who's serving lately." },
  checkins: { href: "/checkins", defaultLabel: "Check-ins", activeAliases: ["Check-ins"], description: "Check-in events and attendance from Planning Center." },
  "lanes-overview": { href: "/lanes", defaultLabel: "Activity overview", activeAliases: ["Activity overview", "Activity / Lanes"], description: "The next-steps pathway at a glance — who's in each lane." },
  "lanes-list": { href: "/lanes/list", defaultLabel: "Lanes", activeAliases: ["Lanes"], description: "Every lane with its people and recent movement." },
  more: { href: "/more", defaultLabel: "See more", activeAliases: ["See more"], description: "The full gallery of layers, searchable." },
  "shepherd-map": { href: "/shepherd-map", defaultLabel: "Shepherd map", activeAliases: ["Shepherd map"], description: "Who shepherds whom, mapped across the church." },
  "care-map": { href: "/care-map", defaultLabel: "Care map", activeAliases: ["Care map"], description: "Care assignments mapped across the congregation." },
  // Settings & Integration members
  pco: { href: "/pco", defaultLabel: "PCO", activeAliases: ["PCO"], description: "The source of people, groups, teams, and check-ins. Connect the account and manage the sync." },
  pushpay: { href: "/pushpay", defaultLabel: "PushPay", activeAliases: ["PushPay"], description: "Drop the donor export to line giving up against people, and reconcile the ambiguous matches." },
  "constant-contact": { href: "/constant-contact", defaultLabel: "Constant Contact", activeAliases: ["Constant Contact"], description: "Email engagement — contacts, campaigns, opens and clicks — joined to your PCO people." },
  subsplash: { href: "/subsplash", defaultLabel: "Subsplash", activeAliases: ["Subsplash"], description: "Connect your Subsplash account." },
  filters: { href: "/pco/filters", defaultLabel: "Filters", activeAliases: ["Filters"], description: "Which group types, team types, and events count toward engagement and the lanes." },
  metrics: { href: "/metrics", defaultLabel: "Metrics", activeAliases: ["Metrics"], description: "The activity windows and thresholds the dashboards use to classify people." },
  appearance: { href: "/settings/appearance", defaultLabel: "Appearance", activeAliases: ["Appearance"], description: "Theme, and the syntax colors for the SQL editor." },
  performance: { href: "/settings/performance", defaultLabel: "Performance", activeAliases: ["Performance"], description: "Why pages are slow, what's expensive, and the optimizations you can approve." },
  navigation: { href: "/settings/navigation", defaultLabel: "Navigation", activeAliases: ["Navigation"], description: "Arrange the home hub — name your layers and choose which pages live in each." },

  // Audit & data hygiene
  "audit-membership": { href: "/audit", defaultLabel: "Membership audit", activeAliases: ["Membership audit"], description: "Flags member rows that look wrong — deceased, status=inactive, junk names, possible duplicates — with a CSV export of PCO profile links so you can fix them upstream." },
  "audit-membership-fit": { href: "/audit/membership-fit", defaultLabel: "Membership fit audit", activeAliases: ["Membership fit"], description: "One tab per membership type, each with the requirements for staying in it, checked against real activity — giving, groups, teams, serving, check-ins, events, forms. Catches contributors who now attend, first-time visitors on their fortieth visit, \u201cformer\u201d members still serving, and members with nothing on record." },
  "audit-duplicates": { href: "/audit/duplicates", defaultLabel: "Duplicate audit", activeAliases: ["Duplicate audit"], description: "Same-name people paired up with the reasons they're likely the same person (matching email, birthdate, address) vs. a parent/child household. Skips inactive-only pairs and flags active+inactive ones that may be returning." },
  "audit-names": { href: "/audit/names", defaultLabel: "Name audit", activeAliases: ["Name audit"], description: "Records whose name looks wrong — empty, punctuation-only, digits, single-letter, or repeated characters. Catches placeholder rows and test accounts. System-use accounts are ignored." },
  "audit-pushpay": { href: "/audit/pushpay", defaultLabel: "PushPay connections", activeAliases: ["PushPay connections"], description: "Reconcile imported PushPay donors we couldn't confidently match to a person — assign the ambiguous ones (same name, or shared household email) and the unmatched ones to the right PCO record." },

  // Reports & insights
  demographics: { href: "/demographics", defaultLabel: "Membership demographics", activeAliases: ["Membership demographics"], description: "Who makes up the church — membership status, age, gender, and whether they have kids — for everyone, the engaged population, people in groups, or people on teams." },
  attendance: { href: "/attendance", defaultLabel: "Attendance", activeAliases: ["Attendance"], description: "Weekly Sunday attendance from imported spreadsheets — trends, weather and preacher correlations, adults vs. kids, year-over-year growth and variability." },
  pipeline: { href: "/pipeline", defaultLabel: "Pipeline", activeAliases: ["Pipeline"], description: "From interest to action: time from a form submission to first serve, and from a group application to first attended event, with a 5-year cohort trend." },
  "sermon-impact": { href: "/sermon-impact", defaultLabel: "Sermon impact", activeAliases: ["Sermon impact"], description: "What each sermon called people toward — giving, groups, serving, outreach — lined up against measurable congregation activity in the 5 weeks after. Bridges Sermon Lab transcripts to your PCO data." },
  mir: { href: "/mir", defaultLabel: "Ministry Impact Reports", activeAliases: ["Ministry Impact Reports"], description: "Nonprofit logic-model docs — Resources, Activities, Outputs, Outcomes, Impact — describing what each ministry accomplishes and for whom." },
  graph: { href: "/graph", defaultLabel: "Relationship graph", activeAliases: ["Relationship graph"], description: "An interactive node-web of everyone in the church. Lines connect people who shepherd one another through group / team leadership or a care roster." },
  "intake-graph": { href: "/intake-graph", defaultLabel: "Who knows who", activeAliases: ["Who knows who"], description: "The relationship webs from the \u201cwho do you know\u201d forms — /know and /present as separate graphs, shepherd team in blue and everyone else grey — plus coverage stats." },
  retention: { href: "/retention", defaultLabel: "Retention", activeAliases: ["Retention"], description: "Of the people who joined in a given year, how many are still active — with per-cohort decay curves and which join months retain best." },
  map: { href: "/map", defaultLabel: "Member map", activeAliases: ["Member map"], description: "Where your people live, plotted around Faith Church. Addresses are geocoded (free US Census geocoder) and colored by classification." },
  "reaching-the-valley": { href: "/reaching-the-valley", defaultLabel: "Reaching the Lehigh Valley", activeAliases: ["Reaching the Lehigh Valley"], description: "Churched vs. unchurched across the Lehigh Valley by census tract — how much of the area Faith Church reaches, and where the biggest unreached need is." },
  "next-campus-planner": { href: "/next-campus-planner", defaultLabel: "Next campus planner", activeAliases: ["Next campus planner"], description: "Where to plant a second campus — your people's geographic center, the unreached need, land-cost-aware site suggestions, and a healthy-growth ceiling." },

  // Constant Contact
  "email-dashboard": { href: "/constant-contact/dashboard", defaultLabel: "Email dashboard", activeAliases: ["Constant Contact dashboard", "Email dashboard"], description: "Contacts, lists, campaigns, and per-person opens / clicks / bounces — linked to PCO people by email. Shows what people opted into and whether email-engaged people take next steps more." },

  // Internal
  builder: { href: "/builder", defaultLabel: "Page Builder", activeAliases: ["Page Builder"], description: "Build your own dashboards from blocks — stat cards, bar charts, tables, and text — each powered by a read-only SQL query." },
  examples: { href: "/examples", defaultLabel: "Design references", activeAliases: ["Design references"], description: "Internal style guide — the design tokens, component variants, and chart variants the rest of the app pulls from." },
  "sql-admin": { href: "https://shepherdly-sql.danmarzari.com", defaultLabel: "SQL Admin", activeAliases: ["SQL Admin"], external: true, description: "Browse tables and views, inspect the schema, and run ad-hoc SQL against the live database (sqlite-web, behind a separate login). Opens in a new tab." },

  settings: { href: "/settings", defaultLabel: "Settings & Integration", activeAliases: ["Settings & Integration"], description: "Everything that connects Shepherdly to your other systems and tunes how it behaves." },

  // The hand-coded originals of three pages the Page Builder now renders. Kept
  // live for comparison; deliberately NOT reusing the live pages' aliases,
  // since ACTIVE_TO_KEY is last-write-wins and would steal their highlighting.
  "checkins-original": { href: "/checkins-original", defaultLabel: "Check-ins (original design)", activeAliases: ["Check-ins (original)"], description: "The hand-coded Check-ins page, kept for comparison against the Page Builder rebuild." },
  "demographics-original": { href: "/demographics-original", defaultLabel: "Membership demographics (original design)", activeAliases: ["Membership demographics (original)"], description: "The hand-coded demographics page, kept for comparison against the Page Builder rebuild." },
  "groups-original": { href: "/groups-original", defaultLabel: "Groups (original design)", activeAliases: ["Groups (original)"], description: "The hand-coded Groups page, kept for comparison against the Page Builder rebuild." },

  // Reachable pages not in any default layer — addable to one from the editor.
  movement: { href: "/movement", defaultLabel: "Movement", activeAliases: ["Movement"], description: "How people move between activity levels over time." },
  staff: { href: "/staff", defaultLabel: "Staff", activeAliases: ["Staff"], description: "Staff members and what each of them oversees." },
  giving: { href: "/giving", defaultLabel: "Giving statistics", activeAliases: ["Giving statistics"], description: "Giving from the PushPay import — coverage, stages, and funds." },
  "announcement-impact": { href: "/announcement-impact", defaultLabel: "Announcement impact", activeAliases: ["Announcement impact"], description: "What each announcement asked for, against what people actually did afterward." },
  sermons: { href: "/sermons", defaultLabel: "Sermons", activeAliases: ["Sermons"], description: "Sermons with their transcripts and the next steps each one called for." },
  "service-plans": { href: "/service-plans", defaultLabel: "Service plans", activeAliases: ["Service plans"], description: "Service plans from Planning Center Services, and who was scheduled." },
  "constant-contact-explore": { href: "/constant-contact/explore", defaultLabel: "Email explorer", activeAliases: ["Email explorer", "Constant Contact explore"], description: "Dig into individual campaigns, lists, and contact activity from Constant Contact." },
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
export type NavSurface = "hub" | "settings";
export type NavItemRef =
  | { kind: "page"; pageKey: string }
  | { kind: "builder"; slug: string; label: string };
export interface NavGroup {
  id: string;
  label: string;
  mode: NavMode;
  collapsible?: boolean;
  /** Nav-icon id (see components/NavIcon) shown next to the layer. */
  icon?: string;
  /** One line under the layer title on the hub. */
  blurb?: string;
  /** Which surface this layer renders on. "settings" layers appear on
   *  /settings (reached from the top-right menu) instead of the home hub.
   *  Defaults to "hub". Both are edited in the same Nav Builder — a layer that
   *  renders somewhere the builder cannot see is the whole bug this closes. */
  surface?: NavSurface;
  items: NavItemRef[];
}
export interface NavConfig {
  version: number;
  groups: NavGroup[];
}

/** Bumped when DEFAULT_NAV_CONFIG grows groups that an already-saved config
 *  should inherit. See migrateNavConfig. */
export const NAV_CONFIG_VERSION = 3;

const P = (pageKey: string): NavItemRef => ({ kind: "page", pageKey });

/** The seeded default: every layer of the home hub, plus the credentials /
 *  filters / metrics / appearance pages consolidated into one Settings &
 *  Integration group (which lives in the top-right menu, not the hub).
 *
 *  Everything here is editable at /settings/navigation. The audit, reports,
 *  email and internal layers used to be a hardcoded array in more-sections.ts,
 *  which meant they showed up on the hub but were invisible to the editor —
 *  the one place you would go to change them. */
export const DEFAULT_NAV_CONFIG: NavConfig = {
  version: NAV_CONFIG_VERSION,
  groups: [
    { id: "dashboard", label: "Dashboard", mode: "top", items: [P("home"), P("care-queue")] },
    { id: "leadership", label: "Leadership", mode: "top", items: [P("shepherd-team"), P("shepherds")] },
    { id: "pco", label: "PCO data", mode: "top", collapsible: true, items: [P("people"), P("groups"), P("teams"), P("checkins")] },
    { id: "next-steps", label: "Next steps", mode: "top", items: [P("lanes-overview"), P("lanes-list"), P("announcement-impact"), P("sermons"), P("service-plans")] },
    { id: "mappings", label: "Maps", mode: "top", collapsible: true, items: [P("shepherd-map"), P("care-map")] },
    { id: "more", label: "More", mode: "top", items: [P("more")] },
    {
      id: "audit",
      label: "Audit & data hygiene",
      mode: "top",
      icon: "checklist",
      blurb: "Find and clean up bad records so the rest of the app stays trustworthy.",
      items: [P("audit-membership"), P("audit-membership-fit"), P("audit-duplicates"), P("audit-names"), P("audit-pushpay")],
    },
    {
      id: "reports",
      label: "Reports & insights",
      mode: "top",
      icon: "chart-bar",
      items: [P("demographics"), P("attendance"), P("pipeline"), P("sermon-impact"), P("mir"), P("graph"), P("intake-graph"), P("retention"), P("map"), P("reaching-the-valley"), P("next-campus-planner")],
    },
    {
      id: "email",
      label: "Constant Contact",
      mode: "top",
      icon: "mail",
      blurb: "Email engagement from Constant Contact, joined to your PCO people.",
      items: [P("email-dashboard")],
    },
    {
      id: "internal",
      label: "Internal",
      mode: "top",
      icon: "admin-key",
      items: [P("builder"), P("examples"), P("sql-admin")],
    },
    // The two layers /settings renders. They used to be a hardcoded array in
    // settings/page.tsx, invisible to the Nav Builder like every other
    // hardcoded section list.
    {
      id: "settings-integration",
      label: "Integrations",
      mode: "drill",
      surface: "settings",
      icon: "database",
      blurb: "The systems Shepherdly reads from.",
      items: [P("pco"), P("pushpay"), P("constant-contact"), P("subsplash")],
    },
    {
      id: "settings-configuration",
      label: "Configuration",
      mode: "drill",
      surface: "settings",
      icon: "sliders",
      blurb: "How the app computes, measures, and looks.",
      items: [P("filters"), P("metrics"), P("appearance"), P("performance"), P("navigation")],
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
    const icon = typeof gg.icon === "string" && gg.icon.trim() ? gg.icon.trim().slice(0, 40) : undefined;
    const blurb = typeof gg.blurb === "string" && gg.blurb.trim() ? gg.blurb.trim().slice(0, 200) : undefined;
    // An explicit choice always wins. With the field absent — every config
    // saved before v3 — the old settings-integration group keeps rendering on
    // /settings rather than silently moving onto the home hub.
    const surface: NavSurface | undefined =
      gg.surface === "settings" || gg.surface === "hub"
        ? gg.surface
        : id === "settings-integration"
          ? "settings"
          : undefined;
    groups.push({ id, label, mode, collapsible: gg.collapsible === true, icon, blurb, surface, items });
  }
  // An admin who deletes every layer to rebuild from scratch means it. Only
  // treat the row as corrupt when it HAD groups and every one was garbage —
  // returning null for a deliberate empty layout handed back the factory
  // default and reported the save as successful.
  if (groups.length === 0 && (obj.groups as unknown[]).length > 0) return null;
  const version = typeof (raw as { version?: unknown }).version === "number" ? (raw as { version: number }).version : 1;
  return { version, groups };
}

/** Groups introduced per config version — the layers that used to be hardcoded
 *  somewhere else. Only these are backfilled, and only into a config older than
 *  the version that added them. */
const NEW_GROUPS_BY_VERSION: Record<number, string[]> = {
  2: ["audit", "reports", "email", "internal"],
  3: ["settings-configuration"],
};

/** Bring an already-saved config up to the current version.
 *
 *  Only the groups NEW in this version are added. Older groups are never
 *  re-seeded, so a layer someone deliberately deleted stays deleted — and a
 *  page they already moved into a layer of their own isn't duplicated into
 *  the incoming one. */
export function migrateNavConfig(config: NavConfig): { config: NavConfig; changed: boolean } {
  if (config.version >= NAV_CONFIG_VERSION) return { config, changed: false };
  const haveGroup = new Set(config.groups.map((g) => g.id));
  const havePage = new Set(
    config.groups.flatMap((g) => g.items.filter((it) => it.kind === "page").map((it) => (it as { pageKey: string }).pageKey)),
  );
  const added = Object.entries(NEW_GROUPS_BY_VERSION)
    .filter(([v]) => config.version < Number(v))
    .flatMap(([, ids]) => ids);
  const incoming = DEFAULT_NAV_CONFIG.groups
    .filter((g) => added.includes(g.id) && !haveGroup.has(g.id))
    .map((g) => ({ ...g, items: g.items.filter((it) => it.kind !== "page" || !havePage.has(it.pageKey)) }))
    .filter((g) => g.items.length > 0);
  return {
    config: { version: NAV_CONFIG_VERSION, groups: [...structuredClone(config.groups), ...structuredClone(incoming)] },
    changed: true,
  };
}
