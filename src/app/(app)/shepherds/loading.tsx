import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function ShepherdsLoading() {
  return (
    <PageSkeleton
      title="Shepherds"
      active="Shepherds"
      breadcrumb="Shepherds"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
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
