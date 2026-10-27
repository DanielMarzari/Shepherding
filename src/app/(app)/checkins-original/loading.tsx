import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

/** Streams while /checkins-original runs its queries, so the wait shows the page's own
 *  shape instead of a blank screen. */
export default function CheckinsOriginalLoading() {
  return (
    <PageSkeleton title="Check-ins (original design)" active="Check-ins (original)" breadcrumb="Check-ins (original design)">
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
