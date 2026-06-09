import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function RetentionLoading() {
  return (
    <PageSkeleton title="Retention" active="See more" breadcrumb="See more › Retention">
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="h-20 rounded-xl bg-bg-elev-2/40" />
          <div className="h-20 rounded-xl bg-bg-elev-2/40" />
          <div className="h-20 rounded-xl bg-bg-elev-2/40" />
        </div>
        <div className="h-72 rounded-xl bg-bg-elev-2/40" />
        <TableSkeleton rows={6} />
      </div>
    </PageSkeleton>
  );
}
