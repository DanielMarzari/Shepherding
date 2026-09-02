import { PageSkeleton } from "@/components/PageSkeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Sermons"
      active="Sermons"
      breadcrumb="Next steps › Sermons"
      statCount={0}
      contentRows={6}
    />
  );
}
