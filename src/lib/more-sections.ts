import "server-only";
import { listMorePages } from "./builder";
import type { GalleryLink, GallerySection } from "./gallery-types";

// The standard SQLite web GUI (sqlite-web), hosted on its own subdomain behind
// Caddy basic-auth. Override with SQL_ADMIN_URL if the host changes.
const SQL_ADMIN_URL = process.env.SQL_ADMIN_URL ?? "https://shepherdly-sql.danmarzari.com";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The hand-curated utility sections (rich descriptions). Builder pages the
// admin listed on See More are merged in per their heading.
const BASE: Array<{ title: string; blurb?: string; links: GalleryLink[] }> = [
  {
    title: "Audit & data hygiene",
    blurb: "Find and clean up bad records so the rest of the app stays trustworthy.",
    links: [
      { href: "/audit", title: "Membership audit", description: "Flags member rows that look wrong — deceased, status=inactive, junk names, possible duplicates — with a CSV export of PCO profile links so you can fix them upstream." },
      { href: "/audit/duplicates", title: "Duplicate audit", description: "Same-name people paired up with the reasons they're likely the same person (matching email, birthdate, address) vs. a parent/child household. Skips inactive-only pairs and flags active+inactive ones that may be returning." },
      { href: "/audit/names", title: "Name audit", description: "Records whose name looks wrong — empty, punctuation-only, digits, single-letter, or repeated characters. Catches placeholder rows and test accounts. System-use accounts are ignored." },
      { href: "/audit/pushpay", title: "PushPay connections", description: "Reconcile imported PushPay donors we couldn't confidently match to a person — assign the ambiguous ones (same name, or shared household email) and the unmatched ones to the right PCO record." },
    ],
  },
  {
    title: "Reports & insights",
    links: [
      { href: "/demographics", title: "Membership demographics", description: "Who makes up the church — membership status, age, gender, and whether they have kids — for everyone, the engaged population, people in groups, or people on teams." },
      { href: "/attendance", title: "Attendance", description: "Weekly Sunday attendance from imported spreadsheets — trends, weather and preacher correlations, adults vs. kids, year-over-year growth and variability." },
      { href: "/pipeline", title: "Pipeline", description: "From interest to action: time from a form submission to first serve, and from a group application to first attended event, with a 5-year cohort trend." },
      { href: "/mir", title: "Ministry Impact Reports", description: "Nonprofit logic-model docs — Resources, Activities, Outputs, Outcomes, Impact — describing what each ministry accomplishes and for whom." },
      { href: "/graph", title: "Relationship graph", description: "An interactive node-web of everyone in the church. Lines connect people who shepherd one another through group / team leadership or a care roster." },
      { href: "/intake-graph", title: "Who knows who", description: "The relationship webs from the “who do you know” forms — /know and /present as separate graphs, shepherd team in blue and everyone else grey — plus coverage stats." },
      { href: "/retention", title: "Retention", description: "Of the people who joined in a given year, how many are still active — with per-cohort decay curves and which join months retain best." },
      { href: "/map", title: "Member map", description: "Where your people live, plotted around Faith Church. Addresses are geocoded (free US Census geocoder) and colored by classification." },
      { href: "/reaching-the-valley", title: "Reaching the Lehigh Valley", description: "Churched vs. unchurched across the Lehigh Valley by census tract — how much of the area Faith Church reaches, and where the biggest unreached need is." },
      { href: "/next-campus-planner", title: "Next campus planner", description: "Where to plant a second campus — your people's geographic center, the unreached need, land-cost-aware site suggestions, and a healthy-growth ceiling." },
    ],
  },
  {
    title: "Constant Contact",
    blurb: "Email engagement from Constant Contact, joined to your PCO people.",
    links: [
      { href: "/constant-contact/dashboard", title: "Email dashboard", description: "Contacts, lists, campaigns, and per-person opens / clicks / bounces — linked to PCO people by email. Shows what people opted into and whether email-engaged people take next steps more." },
    ],
  },
  {
    title: "Internal",
    links: [
      { href: "/builder", title: "Page Builder", description: "Build your own dashboards from blocks — stat cards, bar charts, tables, and text — each powered by a read-only SQL query." },
      { href: "/examples", title: "Design references", description: "Internal style guide — the design tokens, component variants, and chart variants the rest of the app pulls from." },
      { href: SQL_ADMIN_URL, title: "SQL Admin", description: "Browse tables and views, inspect the schema, and run ad-hoc SQL against the live database (sqlite-web, behind a separate login). Opens in a new tab.", external: true },
    ],
  },
];

/** The See More sections with per-org builder pages merged into their heading. */
export function getMoreSections(orgId: number): GallerySection[] {
  const morePages = listMorePages(orgId);
  const extra = new Map<string, GalleryLink[]>();
  for (const p of morePages) {
    const link: GalleryLink = { href: `/builder/${p.slug}`, title: p.title, description: p.description ?? "Custom page." };
    if (!extra.has(p.moreSection)) extra.set(p.moreSection, []);
    extra.get(p.moreSection)!.push(link);
  }
  const sections: GallerySection[] = BASE.map((sec) => {
    const key = [...extra.keys()].find((k) => k.toLowerCase() === sec.title.toLowerCase());
    const links = key ? [...sec.links, ...extra.get(key)!] : sec.links;
    if (key) extra.delete(key);
    return { id: slugify(sec.title), label: sec.title, blurb: sec.blurb, links };
  });
  for (const [heading, links] of extra) sections.push({ id: slugify(heading), label: heading, links });
  return sections;
}
