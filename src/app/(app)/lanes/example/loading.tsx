import { PageSkeleton } from "@/components/PageSkeleton";

export default function LanesExampleLoading() {
  return (
    <PageSkeleton
      title="Activity / Lanes — Design preview"
      active="Activity / Lanes"
      breadcrumb="Lanes › Design preview"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft p-4 h-24"
          />
        ))}
      </div>
      <div className="rounded-[10px] bg-bg-elev border border-border-soft h-[480px]" />
    </PageSkeleton>
  );
}
