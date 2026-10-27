import { PageSkeleton } from "@/components/PageSkeleton";

/** Streams while /demographics-original runs its queries, so the wait shows the page's own
 *  shape instead of a blank screen. */
export default function DemographicsOriginalLoading() {
  return (
    <PageSkeleton title="Membership demographics (original design)" active="Membership demographics (original)" breadcrumb="Membership demographics (original design)">
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
