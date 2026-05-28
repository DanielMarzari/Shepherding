import { PageSkeleton } from "@/components/PageSkeleton";

export default function MetricsLoading() {
  return (
    <PageSkeleton
      title="Metrics"
      active="Metrics"
      breadcrumb="Settings › Metrics"
      statCount={5}
      contentRows={3}
    />
  );
}
