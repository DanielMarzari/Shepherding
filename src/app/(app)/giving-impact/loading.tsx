import { PageSkeleton } from "@/components/PageSkeleton";

export default function GivingImpactLoading() {
  return (
    <PageSkeleton
      title="Giving impact"
      active="Giving impact"
      breadcrumb="Next steps › Giving impact"
      statCount={4}
      contentRows={4}
    />
  );
}
