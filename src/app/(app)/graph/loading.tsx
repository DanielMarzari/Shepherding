import { PageSkeleton } from "@/components/PageSkeleton";

export default function GraphLoading() {
  return (
    <PageSkeleton
      title="Graph"
      active="See more"
      breadcrumb="See more › Graph"
      statCount={0}
      contentRows={1}
    >
      <div className="rounded-[10px] bg-bg-elev border border-border-soft h-[600px]" />
    </PageSkeleton>
  );
}
