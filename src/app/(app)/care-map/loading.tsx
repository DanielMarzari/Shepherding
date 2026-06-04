import { PageSkeleton } from "@/components/PageSkeleton";

export default function CareMapLoading() {
  return (
    <PageSkeleton
      title="Care map"
      active="Care map"
      breadcrumb="Data Mappings › Care map"
      statCount={0}
      contentRows={1}
    >
      <div className="rounded-[10px] bg-bg-elev border border-border-soft h-[600px]" />
    </PageSkeleton>
  );
}
