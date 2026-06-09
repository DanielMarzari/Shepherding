import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";

interface MoreLink {
  href: string;
  title: string;
  description: string;
}
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
    ],
  },
  {
    title: "Reports & insights",
    links: [
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
    title: "Internal",
    links: [
      {
        href: "/examples",
        title: "Design references",
        description:
          "Internal style guide — the design tokens, component variants, and chart variants the rest of the app pulls from.",
      },
    ],
  },
];

export default function MorePage() {
  return (
    <AppShell active="See more" breadcrumb="See more">
      <div className="px-5 md:px-7 py-7 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">See more</h1>
          <p className="text-muted text-sm mt-1">
            Utility pages that don&apos;t fit cleanly into Dashboard, PCO data,
            or the lane pathway.
          </p>
        </div>
        {SECTIONS.map((section) => (
          <section key={section.title} className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                {section.title}
              </h2>
              {section.blurb && (
                <p className="text-xs text-subtle mt-1">{section.blurb}</p>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {section.links.map((l) => (
                <Card key={l.href} className="p-5">
                  <Link
                    href={l.href}
                    className="font-semibold hover:text-accent"
                  >
                    {l.title} →
                  </Link>
                  <p className="text-xs text-muted leading-relaxed mt-2">
                    {l.description}
                  </p>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
