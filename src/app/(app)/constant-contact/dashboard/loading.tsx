import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

/** Streams while /constant-contact/dashboard runs its queries, so the wait shows the page's own
 *  shape instead of a blank screen. */
export default function ConstantContactDashboardLoading() {
  return (
    <PageSkeleton title="Email dashboard" active="Constant Contact dashboard" breadcrumb="See more › Constant Contact › Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft p-4 h-24"
          />
        ))}
      </div>
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
