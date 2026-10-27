import { PageSkeleton } from "@/components/PageSkeleton";

/** Streams while /settings/integrations runs its queries, so the wait shows the page's own
 *  shape instead of a blank screen. */
export default function SettingsIntegrationsLoading() {
  return (
    <PageSkeleton title="Credentials" active="Credentials" breadcrumb="Settings › Credentials">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft h-48"
          />
        ))}
      </div>
    </PageSkeleton>
  );
}
