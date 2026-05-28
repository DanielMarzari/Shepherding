import { PageSkeleton } from "@/components/PageSkeleton";

export default function PcoLoading() {
  return (
    <PageSkeleton
      title="PCO sync"
      active="Sync"
      breadcrumb="Settings › Sync"
      statCount={0}
      contentRows={4}
    />
  );
}
