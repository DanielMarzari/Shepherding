import { PageSkeleton } from "@/components/PageSkeleton";

/** Streams while /attendance-new runs its queries, so the wait shows the page's own
 *  shape instead of a blank screen. */
export default function AttendanceNewLoading() {
  return (
    <PageSkeleton title="Attendance (new — in review)" active="Attendance" breadcrumb="Attendance (new — in review)">
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
