import { PageSkeleton } from "@/components/PageSkeleton";

/** Streams while /shepherd-team/assign/pool runs its queries, so the wait shows the page's own
 *  shape instead of a blank screen. */
export default function ShepherdTeamAssignPoolLoading() {
  return (
    <PageSkeleton title="Assign the pool" active="Assignment" breadcrumb="Shepherd team › Pool">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft h-48"
          />
        ))}
      </div>
    </PageSkeleton>
  );
}
