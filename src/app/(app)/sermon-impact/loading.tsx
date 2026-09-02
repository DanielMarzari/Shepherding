import { PageSkeleton } from "@/components/PageSkeleton";

export default function SermonImpactLoading() {
  return (
    <PageSkeleton
      title="Sermon impact"
      active="Sermon impact"
      breadcrumb="Sermon impact"
      statCount={0}
      contentRows={5}
    />
  );
}
