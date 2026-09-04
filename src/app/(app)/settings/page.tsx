import { AppShell } from "@/components/AppShell";
import { GalleryHub } from "@/components/GalleryHub";
import { requireOrg } from "@/lib/auth";
import { getPinnedKeys } from "@/lib/nav-config-db";
import { buildSettingsSections } from "@/lib/hub-sections";

export default async function SettingsPage() {
  const session = await requireOrg();
  const pinned = getPinnedKeys(session.orgId, session.user.id);
  // These layers used to be a hardcoded array right here, which meant the two
  // tabs on this page could not be renamed, reordered or refilled from the Nav
  // Builder — the same defect as the old hub BASE array.
  const SECTIONS = buildSettingsSections(session.orgId);
  return (
    <AppShell active="Settings & Integration" breadcrumb="Settings & Integration" rail={false}>
      <div className="px-5 md:px-7 py-7">
        <GalleryHub
          sections={SECTIONS}
          pinned={pinned}
          homeLabel="Settings & Integration"
          homeContent={
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Settings &amp; Integration</h1>
              <p className="text-muted text-sm mt-1 max-w-2xl">
                Everything that connects Shepherdly to your other systems and
                tunes how it behaves. Pick a category on the left, or search.
              </p>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SECTIONS.map((s) => (
                  <div key={s.id} className="rounded-xl border border-border-soft p-4">
                    <div className="font-semibold text-sm">{s.label}</div>
                    {s.blurb && <p className="text-xs text-muted mt-0.5">{s.blurb}</p>}
                    <p className="text-[11px] text-subtle mt-2">
                      {s.links.map((l) => l.title).join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          }
        />
      </div>
    </AppShell>
  );
}
