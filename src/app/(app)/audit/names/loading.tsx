import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function AuditNamesLoading() {
  return (
    <PageSkeleton
      title="Name audit"
      active="See more"
      breadcrumb="See more › Audit › Names"
      statCount={0}
    >
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
