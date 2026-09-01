import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { getNavConfig } from "@/lib/nav-config-db";
import { NavEditor } from "./nav-editor";

export default async function NavigationSettingsPage() {
  const session = await requireOrg();
  const config = getNavConfig(session.orgId);
  return (
    <AppShell active="Navigation" breadcrumb="Settings & Integration › Navigation">
      <div className="px-5 md:px-7 py-7 space-y-5 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Navigation</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Arrange the left sidebar — rename headings, reorder them, choose which
            pages sit under each, and set a heading to drill-in (a single entry
            that opens its own list). Changes apply everywhere the moment you save.
          </p>
        </div>
        <NavEditor initial={config} isAdmin={session.role === "admin"} />
      </div>
    </AppShell>
  );
}
