import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function CheckinsLoading() {
  return (
    <PageSkeleton
      title="Check-ins"
      active="Check-ins"
      breadcrumb="Check-ins"
      statCount={4}
    >
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
