import { PageSkeleton } from "@/components/PageSkeleton";

export default function NextCampusPlannerLoading() {
  return (
    <PageSkeleton title="Next campus planner" active="See more" breadcrumb="See more › Next campus planner">
      <div className="space-y-3">
        <div className="h-24 rounded-xl bg-bg-elev-2/40" />
        <div className="w-full rounded-xl bg-bg-elev-2/40" style={{ height: "60vh", minHeight: 360 }} />
      </div>
    </PageSkeleton>
  );
}
