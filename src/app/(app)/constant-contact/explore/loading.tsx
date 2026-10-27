import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

/** Streams while /constant-contact/explore runs its queries, so the wait shows the page's own
 *  shape instead of a blank screen. */
export default function ConstantContactExploreLoading() {
  return (
    <PageSkeleton title="Explore Constant Contact" active="Constant Contact" breadcrumb="Credentials › Constant Contact › Explore">
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
