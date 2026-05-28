import { PageSkeleton } from "@/components/PageSkeleton";

export default function PipelineLoading() {
  return (
    <PageSkeleton
      title="Pipeline"
      active="See more"
      breadcrumb="See more › Pipeline"
      statCount={0}
      contentRows={3}
    />
  );
}
