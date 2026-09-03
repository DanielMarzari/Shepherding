import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { getNavConfig } from "@/lib/nav-config-db";
import { listBuilderPages } from "@/lib/builder";
import { NavEditor } from "./nav-editor";

export default async function NavigationSettingsPage() {
  const session = await requireOrg();
  const config = getNavConfig(session.orgId);
  const builderPages = listBuilderPages(session.orgId).map((p) => ({ slug: p.slug, title: p.title }));
  return (
    <AppShell active="Navigation" breadcrumb="Settings & Integration › Navigation" rail={false}>
      <div className="px-5 md:px-7 py-7 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nav builder</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Arrange your home hub — it looks like the real thing: layers on the
            left, that layer&apos;s pages on the right. Drag to reorder, rename a
            layer inline, and add pages (existing or brand-new). Changes apply
            everywhere the moment you save.
          </p>
        </div>
        <NavEditor initial={config} builderPages={builderPages} isAdmin={session.role === "admin"} />
      </div>
    </AppShell>
  );
}
