import { PageSkeleton } from "@/components/PageSkeleton";

export default function MovementLoading() {
  return (
    <PageSkeleton
      title="Movement"
      active="See more"
      breadcrumb="See more › Movement"
      statCount={4}
      contentRows={3}
    />
  );
}
