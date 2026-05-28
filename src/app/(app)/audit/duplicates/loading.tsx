import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function AuditDuplicatesLoading() {
  return (
    <PageSkeleton
      title="Duplicate people"
      active="See more"
      breadcrumb="See more › Audit › Duplicates"
      statCount={0}
    >
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
