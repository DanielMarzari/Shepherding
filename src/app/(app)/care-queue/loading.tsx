import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function CareQueueLoading() {
  return (
    <PageSkeleton
      title="Care queue"
      active="Care queue"
      breadcrumb="Care queue"
      statCount={4}
    >
      <TableSkeleton rows={10} />
    </PageSkeleton>
  );
}
