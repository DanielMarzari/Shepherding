import { PageSkeleton } from "@/components/PageSkeleton";

export default function PcoFiltersLoading() {
  return (
    <PageSkeleton
      title="PCO sync filters"
      active="Filters"
      breadcrumb="Settings › Filters"
      statCount={0}
      contentRows={3}
    />
  );
}
