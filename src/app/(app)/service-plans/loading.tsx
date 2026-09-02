import { PageSkeleton } from "@/components/PageSkeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Service plans"
      active="Service plans"
      breadcrumb="Next steps › Service plans"
      statCount={0}
      contentRows={6}
    />
  );
}
