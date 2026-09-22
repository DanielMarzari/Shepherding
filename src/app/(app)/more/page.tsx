import { AppShell } from "@/components/AppShell";
import { GalleryHub } from "@/components/GalleryHub";
import { requireOrg } from "@/lib/auth";
import { getPinnedKeys } from "@/lib/nav-config-db";
import { buildHubSections, findSectionId } from "@/lib/hub-sections";

export default async function MorePage({
  searchParams,
}: {
  searchParams: Promise<{ layer?: string | string[] }>;
}) {
  const session = await requireOrg();
  const sections = buildHubSections(session.orgId);
  const pinned = getPinnedKeys(session.orgId, session.user.id);
  // ?layer= opens one layer, e.g. the Ministry Impact Reports card and the old
  // /mir URLs (see next.config.ts). Keyed so a link to another layer from this
  // page switches the rail instead of keeping the hub's current selection.
  const { layer } = await searchParams;
  const initial = findSectionId(sections, typeof layer === "string" ? layer : undefined);

  return (
    <AppShell active="See more" breadcrumb="See more" rail={false}>
      <div className="px-5 md:px-7 py-7 space-y-5 max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">See more</h1>
          <p className="text-muted text-sm mt-1">
            Every layer of the hub in one place. Pick a category, search across
            everything, or star the ones you use most. Arrange the layers
            themselves under Settings &rarr; Navigation.
          </p>
        </div>
        <GalleryHub key={initial ?? ""} sections={sections} pinned={pinned} initialSection={initial} />
      </div>
    </AppShell>
  );
}
