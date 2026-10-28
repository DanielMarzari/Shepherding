import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

/** Streams while /seniors-audit merges the mailing list, the age roster
 *  and whatever is marked as a seniors event. */
export default function SeniorsAuditLoading() {
  return (
    <PageSkeleton
      title="Seniors audit"
      active="Seniors audit"
      breadcrumb="Reports & insights › Seniors audit"
    >
      <div className="rounded-[10px] bg-bg-elev border border-border-soft h-12" />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft p-4 h-20"
          />
        ))}
      </div>
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
