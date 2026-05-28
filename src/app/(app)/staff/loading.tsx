import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function StaffLoading() {
  return (
    <PageSkeleton
      title="Staff"
      active="See more"
      breadcrumb="See more › Staff"
      statCount={0}
    >
      <TableSkeleton rows={8} />
    </PageSkeleton>
  );
}
