import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function ShepherdsExampleLoading() {
  return (
    <PageSkeleton
      title="Shepherds — Design preview"
      active="Shepherds"
      breadcrumb="Shepherds › Design preview"
    >
      <TableSkeleton rows={10} />
    </PageSkeleton>
  );
}
