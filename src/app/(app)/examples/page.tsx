import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";

interface Mock {
  href: string;
  title: string;
  description: string;
  status: "mock" | "partial";
}

const MOCKS: Mock[] = [
  {
    href: "/",
    title: "Home / dashboard",
    description:
      "Pastor's Monday-morning landing page. Top-stat strip, lane summaries, recent movement, suggested shepherding actions. Numbers + names are placeholders.",
    status: "mock",
  },
  {
    href: "/care-queue",
    title: "Care queue",
    description:
      "Prioritized list of people needing attention. Each row has a status, last-contact age, suggested shepherd, and a quick-action menu. Wholly mock — wiring this up needs the real flags-and-rules engine.",
    status: "mock",
  },
  {
    href: "/lanes",
    title: "Lanes overview",
    description:
      "Side-by-side picture of all four lanes (Worship / Community / Care / Serve) with their totals, weekly delta, and a sparkline. Hybrid: the lane KPIs are still mock, the underlying lanes themselves are partially wired.",
    status: "partial",
  },
  {
    href: "/lanes/comm",
    title: "Community lane (detail)",
    description:
      "Per-lane workspace — flock list, suggested handoffs, the visualization of who's coming/going. Reads mock data via LANE_STATS.",
    status: "mock",
  },
  {
    href: "/shepherds/example",
    title: "Shepherd profile",
    description:
      "Full individual-shepherd dashboard: header, capacity strip, flock table, upward chain, handoffs, weekly notes. The bones we want for /shepherds/[id] once we wire real data through.",
    status: "mock",
  },
  {
    href: "/movement",
    title: "Movement",
    description:
      "Sankey of how people move between lanes/groups/teams over time. Mock data; renders against d3-sankey to validate the look.",
    status: "mock",
  },
];

export default function ExamplesPage() {
  return (
    <AppShell active="Design references" breadcrumb="Design references">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Design references
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Pages still running on hand-typed mock data. They're the reference
            for what the eventual real-data version should feel like — useful
            when asking Claude to &ldquo;match the layout of /shepherds/example&rdquo;
            or &ldquo;bring back the suggested-handoffs card.&rdquo;
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MOCKS.map((m) => (
            <Card key={m.href} className="p-5">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <Link
                  href={m.href}
                  className="font-semibold hover:text-accent"
                >
                  {m.title}
                </Link>
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    m.status === "mock"
                      ? "bg-warn-soft-bg text-warn-soft-fg"
                      : "bg-accent-soft-bg text-accent"
                  }`}
                >
                  {m.status === "mock" ? "Mock data" : "Partial — some real"}
                </span>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                {m.description}
              </p>
              <Link
                href={m.href}
                className="text-xs text-accent hover:underline mt-2 inline-block"
              >
                Open {m.href} →
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
