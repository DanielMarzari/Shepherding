import { AppShell } from "@/components/AppShell";
import { GalleryHub, type GallerySection } from "@/components/GalleryHub";
import { requireOrg } from "@/lib/auth";
import { getPinnedKeys } from "@/lib/nav-config-db";
import { listMorePages } from "@/lib/builder";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

interface MoreLink {
  href: string;
  title: string;
  description: string;
  /** Opens in a new tab (for tools hosted outside the app, e.g. SQL Admin). */
  external?: boolean;
}

// The standard SQLite web GUI (sqlite-web), hosted on its own subdomain behind
// Caddy basic-auth. Override with SQL_ADMIN_URL if the host changes.
const SQL_ADMIN_URL =
  process.env.SQL_ADMIN_URL ?? "https://shepherdly-sql.danmarzari.com";
interface MoreSection {
  title: string;
  blurb?: string;
  links: MoreLink[];
}

const SECTIONS: MoreSection[] = [
  {
    title: "Audit & data hygiene",
    blurb:
      "Find and clean up bad records so the rest of the app stays trustworthy.",
    links: [
      {
        href: "/audit",
        title: "Membership audit",
        description:
          "Flags member rows that look wrong — deceased, status=inactive, junk names, possible duplicates — with a CSV export of PCO profile links so you can fix them upstream.",
      },
      {
        href: "/audit/duplicates",
        title: "Duplicate audit",
        description:
          "Same-name people paired up with the reasons they're likely the same person (matching email, birthdate, address) vs. a parent/child household. Skips inactive-only pairs and flags active+inactive ones that may be returning.",
      },
      {
        href: "/audit/names",
        title: "Name audit",
        description:
          "Records whose name looks wrong — empty, punctuation-only, digits, single-letter, or repeated characters. Catches placeholder rows and test accounts. System-use accounts are ignored.",
      },
      {
        href: "/audit/pushpay",
        title: "PushPay connections",
        description:
          "Reconcile imported PushPay donors we couldn't confidently match to a person — assign the ambiguous ones (same name, or shared household email) and the unmatched ones to the right PCO record.",
      },
    ],
  },
  {
    title: "Reports & insights",
    links: [
      {
        href: "/demographics",
        title: "Membership demographics",
        description:
          "Who makes up the church — membership status, age, gender, and whether they have kids — for everyone, the engaged population, people in groups, or people on teams.",
      },
      {
        href: "/attendance",
        title: "Attendance",
        description:
          "Weekly Sunday attendance from imported spreadsheets — trends, weather and preacher correlations, adults vs. kids, year-over-year growth and variability.",
      },
      {
        href: "/pipeline",
        title: "Pipeline",
        description:
          "From interest to action: time from a form submission to first serve, and from a group application to first attended event, with a 5-year cohort trend.",
      },
      {
        href: "/mir",
        title: "Ministry Impact Reports",
        description:
          "Nonprofit logic-model docs — Resources, Activities, Outputs, Outcomes, Impact — describing what each ministry accomplishes and for whom.",
      },
      {
        href: "/graph",
        title: "Relationship graph",
        description:
          "An interactive node-web of everyone in the church. Lines connect people who shepherd one another through group / team leadership or a care roster.",
      },
      {
        href: "/intake-graph",
        title: "Who knows who",
        description:
          "The relationship webs from the “who do you know” forms — /know and /present as separate graphs, shepherd team in blue and everyone else grey — plus coverage stats (% of active / present people someone flags they know).",
      },
      {
        href: "/retention",
        title: "Retention",
        description:
          "Of the people who joined in a given year, how many are still active — with per-cohort decay curves (stacked engaged people or % share, by year or month) and which join months retain best.",
      },
      {
        href: "/map",
        title: "Member map",
        description:
          "Where your people live, plotted around Faith Church. Addresses are geocoded (free US Census geocoder) and colored by classification — useful for spotting clusters and coverage gaps.",
      },
      {
        href: "/reaching-the-valley",
        title: "Reaching the Lehigh Valley",
        description:
          "Churched vs. unchurched across the Lehigh Valley by census tract — how much of the area Faith Church reaches, where the biggest unreached need is, and tract shading by need, income, age, land price, churches, and drive time.",
      },
      {
        href: "/next-campus-planner",
        title: "Next campus planner",
        description:
          "Where to plant a second campus — your people's geographic center, the unreached need, land-cost-aware site suggestions, a drag-to-test map, and a healthy-growth ceiling.",
      },
    ],
  },
  {
    title: "Constant Contact",
    blurb: "Email engagement from Constant Contact, joined to your PCO people.",
    links: [
      {
        href: "/constant-contact/dashboard",
        title: "Email dashboard",
        description:
          "Contacts, lists, campaigns, and per-person opens / clicks / bounces — linked to PCO people by email. Shows what people opted into, how they engage, and whether email-engaged people take next steps more.",
      },
    ],
  },
  {
    title: "Internal",
    links: [
      {
        href: "/builder",
        title: "Page Builder",
        description:
          "Build your own dashboards from blocks — stat cards, bar charts, tables, and text — each powered by a read-only SQL query. Arrange them in a bento grid and share the page.",
      },
      {
        href: "/examples",
        title: "Design references",
        description:
          "Internal style guide — the design tokens, component variants, and chart variants the rest of the app pulls from.",
      },
      {
        href: SQL_ADMIN_URL,
        title: "SQL Admin",
        description:
          "Browse tables and views, inspect the schema, and run ad-hoc SQL against the live database (sqlite-web, hosted on its own subdomain behind a separate login). Opens in a new tab.",
        external: true,
      },
    ],
  },
];

export default async function MorePage() {
  const session = await requireOrg();

  // Merge in builder pages the admin listed on See More, grouped by their
  // heading — matching an existing section title, or creating a new one.
  const morePages = session?.orgId ? listMorePages(session.orgId) : [];
  const groups = new Map<string, MoreLink[]>();
  for (const p of morePages) {
    const link: MoreLink = { href: `/builder/${p.slug}`, title: p.title, description: p.description ?? "Custom page." };
    if (!groups.has(p.moreSection)) groups.set(p.moreSection, []);
    groups.get(p.moreSection)!.push(link);
  }
  const sections: MoreSection[] = SECTIONS.map((sec) => {
    const key = [...groups.keys()].find((k) => k.toLowerCase() === sec.title.toLowerCase());
    if (!key) return sec;
    const links = [...sec.links, ...groups.get(key)!];
    groups.delete(key);
    return { ...sec, links };
  });
  for (const [heading, links] of groups) sections.push({ title: heading, links });

  const gallerySections: GallerySection[] = sections.map((s) => ({
    id: slugify(s.title),
    label: s.title,
    blurb: s.blurb,
    links: s.links,
  }));
  const pinned = getPinnedKeys(session.orgId, session.user.id);

  return (
    <AppShell active="See more" breadcrumb="See more">
      <div className="px-5 md:px-7 py-7 space-y-5 max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">See more</h1>
          <p className="text-muted text-sm mt-1">
            Every audit, report, map, and tool that doesn&apos;t live in the main
            nav. Pick a category, search across everything, or star the ones you
            use most.
          </p>
        </div>
        <GalleryHub sections={gallerySections} pinned={pinned} />
      </div>
    </AppShell>
  );
}
