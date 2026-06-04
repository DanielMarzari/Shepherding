import { PageSkeleton } from "@/components/PageSkeleton";

export default function MapLoading() {
  return (
    <PageSkeleton title="Member map" active="See more" breadcrumb="See more › Map">
      <div
        className="w-full rounded-xl bg-bg-elev-2/40"
        style={{ height: "70vh", minHeight: 420 }}
      />
    </PageSkeleton>
  );
}
