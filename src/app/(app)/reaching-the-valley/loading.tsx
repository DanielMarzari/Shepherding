import { PageSkeleton } from "@/components/PageSkeleton";

export default function ReachingTheValleyLoading() {
  return (
    <PageSkeleton title="Reaching the Lehigh Valley" active="See more" breadcrumb="See more › Reaching the Lehigh Valley">
      <div className="space-y-3">
        <div className="h-24 rounded-xl bg-bg-elev-2/40" />
        <div className="w-full rounded-xl bg-bg-elev-2/40" style={{ height: "60vh", minHeight: 360 }} />
      </div>
    </PageSkeleton>
  );
}
