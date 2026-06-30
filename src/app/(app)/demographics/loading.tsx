import { PageSkeleton } from "@/components/PageSkeleton";
import { DemographicChartsSkeleton } from "@/components/ChartsLoading";

export default function DemographicsLoading() {
  return (
    <PageSkeleton
      title="Membership demographics"
      active="See more"
      breadcrumb="See more › Demographics"
    >
      <DemographicChartsSkeleton title="Demographics" />
    </PageSkeleton>
  );
}
