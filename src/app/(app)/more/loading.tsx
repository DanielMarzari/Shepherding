import { PageSkeleton } from "@/components/PageSkeleton";

export default function MoreLoading() {
  return (
    <PageSkeleton
      title="See more"
      active="See more"
      breadcrumb="See more"
      statCount={0}
      contentRows={2}
    />
  );
}
