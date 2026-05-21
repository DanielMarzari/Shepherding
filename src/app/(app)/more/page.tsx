import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";

interface MoreLink {
  href: string;
  title: string;
  description: string;
}

const LINKS: MoreLink[] = [
  {
    href: "/audit",
    title: "Membership audit",
    description:
      "One-off cleanup view. Flags member rows that look wrong — deceased, status=inactive, junk names, possible duplicates — and lets you download the result as a CSV with PCO profile links so you can fix them upstream.",
  },
  {
    href: "/audit/duplicates",
    title: "Duplicate audit",
    description:
      "Cross-org scan for people who appear more than once under the same first + last name. Groups every matching record together so you can spot staff + member + inactive drift in one place.",
  },
  {
    href: "/audit/names",
    title: "Name audit",
    description:
      "Cross-org scan for records whose name looks wrong — empty, punctuation-only, digits, single-letter, or repeated characters. Catches placeholder rows and test accounts that never got cleaned up.",
  },
  {
    href: "/attendance",
    title: "Attendance",
    description:
      "Manually log weekly Sunday attendance counts so the dashboard can compute attendance frequency rate and other engagement ratios against the active membership.",
  },
  {
    href: "/examples",
    title: "Design references",
    description:
      "Internal style guide. Shows the design tokens, component variants, and chart variants the rest of the app pulls from — handy when extending the UI.",
  },
  {
    href: "/graph",
    title: "Relationship graph",
    description:
      "An interactive node-web of everyone in the church. Lines connect people who shepherd one another — through group / team leadership or a care roster. Drag, zoom, and click a node to open a profile.",
  },
];

export default function MorePage() {
  return (
    <AppShell active="See more" breadcrumb="See more">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">See more</h1>
          <p className="text-muted text-sm mt-1">
            Utility pages that don&apos;t fit cleanly into Dashboard, PCO data,
            or the lane pathway.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LINKS.map((l) => (
            <Card key={l.href} className="p-5">
              <Link href={l.href} className="font-semibold hover:text-accent">
                {l.title} →
              </Link>
              <p className="text-xs text-muted leading-relaxed mt-2">
                {l.description}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
