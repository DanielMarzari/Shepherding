import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { resolveNavConfig } from "@/lib/nav-config-db";
import { listBuilderPages } from "@/lib/builder";
import { BUILDER_SEEDS } from "@/lib/builder-seeds";
import { NavEditor } from "./nav-editor";

export default async function NavigationSettingsPage() {
  const session = await requireOrg();
  // The RESOLVED config, the same one the hub renders — not the raw saved row.
  // Reading the saved row meant every auto-merged page (all forty-one ministry
  // reports) and every group created on demand was live on the hub and absent
  // from the editor, which is the one place you would go to move them.
  const config = resolveNavConfig(session.orgId).config;
  // Every page that COULD exist, not just the rows somebody has already opened.
  // A seeded page (the forty-one ministry reports) has no builder_pages row
  // until its route is first visited, so offering only the table would hide it
  // from the picker — and a page you cannot place is a page you cannot reach.
  const saved = listBuilderPages(session.orgId);
  const known = new Set(saved.map((p) => p.slug));
  const builderPages = [
    ...saved.map((p) => ({ slug: p.slug, title: p.title })),
    ...Object.values(BUILDER_SEEDS)
      .filter((s) => !known.has(s.slug))
      .map((s) => ({ slug: s.slug, title: s.title })),
  ].sort((a, b) => a.title.localeCompare(b.title));
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
