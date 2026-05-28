import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function LanesListLoading() {
  return (
    <PageSkeleton title="Lanes" active="Lanes" breadcrumb="Lanes › List">
      <TableSkeleton rows={14} />
    </PageSkeleton>
  );
}
