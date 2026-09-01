import { AppShell } from "@/components/AppShell";
import { GalleryHub } from "@/components/GalleryHub";
import { requireOrg } from "@/lib/auth";
import { getPinnedKeys } from "@/lib/nav-config-db";
import { getMoreSections } from "@/lib/more-sections";

export default async function MorePage() {
  const session = await requireOrg();
  const sections = getMoreSections(session.orgId);
  const pinned = getPinnedKeys(session.orgId, session.user.id);

  return (
    <AppShell active="See more" breadcrumb="See more">
      <div className="px-5 md:px-7 py-7 space-y-5 max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">See more</h1>
          <p className="text-muted text-sm mt-1">
            Every audit, report, map, and tool that doesn&apos;t live on the home
            hub. Pick a category, search across everything, or star the ones you
            use most.
          </p>
        </div>
        <GalleryHub sections={sections} pinned={pinned} />
      </div>
    </AppShell>
  );
}
