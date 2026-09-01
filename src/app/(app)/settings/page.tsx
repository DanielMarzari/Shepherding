import { AppShell } from "@/components/AppShell";
import { GalleryHub, type GallerySection } from "@/components/GalleryHub";
import { requireOrg } from "@/lib/auth";
import { getPinnedKeys } from "@/lib/nav-config-db";

const SECTIONS: GallerySection[] = [
  {
    id: "integrations",
    label: "Integrations",
    blurb: "The systems Shepherdly reads from.",
    links: [
      { href: "/pco", title: "Planning Center", description: "The source of people, groups, teams, and check-ins. Connect the account and manage the sync." },
      { href: "/pushpay", title: "PushPay", description: "Drop the donor export to line giving up against people, and reconcile the ambiguous matches." },
      { href: "/constant-contact", title: "Constant Contact", description: "Email engagement — contacts, campaigns, opens and clicks — joined to your PCO people." },
      { href: "/subsplash", title: "Subsplash", description: "Connect your Subsplash account." },
    ],
  },
  {
    id: "configuration",
    label: "Configuration",
    blurb: "How the app computes, measures, and looks.",
    links: [
      { href: "/pco/filters", title: "Filters", description: "Which group types, team types, and events count toward engagement and the lanes." },
      { href: "/metrics", title: "Metrics", description: "The activity windows and thresholds the dashboards use to classify people." },
      { href: "/settings/appearance", title: "Appearance", description: "Theme, and the syntax colors for the SQL editor." },
      { href: "/settings/performance", title: "Performance", description: "Why pages are slow, what's expensive, and the optimizations you can approve." },
      { href: "/settings/navigation", title: "Navigation", description: "Arrange the left sidebar — define headings and choose which pages live where." },
    ],
  },
];

export default async function SettingsPage() {
  const session = await requireOrg();
  const pinned = getPinnedKeys(session.orgId, session.user.id);
  return (
    <AppShell active="Settings & Integration" breadcrumb="Settings & Integration">
      <div className="px-5 md:px-7 py-7 space-y-5 max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings &amp; Integration</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Everything that connects Shepherdly to your other systems and tunes
            how it behaves. Pick a page here, or use the sidebar — clicking
            <span className="text-fg"> Settings &amp; Integration</span> there
            drills straight into these.
          </p>
        </div>
        <GalleryHub sections={SECTIONS} pinned={pinned} />
      </div>
    </AppShell>
  );
}
