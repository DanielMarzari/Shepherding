import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

/** Streams while /shepherd-team/gaps walks every live roster looking for
 *  the ones nobody is connected to. */
export default function ShepherdTeamGapsLoading() {
  return (
    <PageSkeleton
      title="Nobody we can name"
      active="Shepherd team"
      breadcrumb="Shepherd team › Gaps"
    >
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
