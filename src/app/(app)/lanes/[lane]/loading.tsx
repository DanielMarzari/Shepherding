import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function LaneDetailLoading() {
  return (
    <PageSkeleton
      active="Activity / Lanes"
      breadcrumb="Lanes › …"
      statCount={4}
    >
      <TableSkeleton rows={14} />
    </PageSkeleton>
  );
}
