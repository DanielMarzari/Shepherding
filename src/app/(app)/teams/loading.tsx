import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function TeamsLoading() {
  return (
    <PageSkeleton title="Teams" active="Teams" breadcrumb="Teams">
      <TableSkeleton rows={14} />
    </PageSkeleton>
  );
}
