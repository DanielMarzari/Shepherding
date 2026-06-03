import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function RetentionLoading() {
  return (
    <PageSkeleton title="Retention" active="Retention" breadcrumb="Retention">
      <TableSkeleton rows={10} />
    </PageSkeleton>
  );
}
