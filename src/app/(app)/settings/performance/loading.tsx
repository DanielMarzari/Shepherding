import { PageSkeleton } from "@/components/PageSkeleton";

export default function PerformanceLoading() {
  return (
    <PageSkeleton
      title="Performance"
      active="Performance"
      breadcrumb="Settings & Integration › Performance"
      statCount={0}
      contentRows={4}
    />
  );
}
