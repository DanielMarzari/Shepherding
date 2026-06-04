import { PageSkeleton } from "@/components/PageSkeleton";

export default function ShepherdMapLoading() {
  return (
    <PageSkeleton
      title="Shepherd map"
      active="Shepherd map"
      breadcrumb="Data Mappings › Shepherd map"
      statCount={0}
      contentRows={1}
    >
      <div className="rounded-[10px] bg-bg-elev border border-border-soft h-[600px]" />
    </PageSkeleton>
  );
}
