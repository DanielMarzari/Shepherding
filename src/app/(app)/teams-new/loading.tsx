import { PageSkeleton } from "@/components/PageSkeleton";

/** Streams while /teams-new runs its queries, so the wait shows the page's own
 *  shape instead of a blank screen. */
export default function TeamsNewLoading() {
  return (
    <PageSkeleton title="Teams (new — in review)" active="Teams" breadcrumb="Teams (new — in review)">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft p-4 h-24"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft h-56"
          />
        ))}
      </div>
    </PageSkeleton>
  );
}
