import { PageSkeleton, TableSkeleton } from "@/components/PageSkeleton";

export default function GroupPipelineDetailLoading() {
  return (
    <PageSkeleton
      active="See more"
      breadcrumb="See more › Pipeline › …"
      statCount={5}
    >
      <TableSkeleton rows={10} />
    </PageSkeleton>
  );
}
