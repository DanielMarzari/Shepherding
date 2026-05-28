import { PageSkeleton } from "@/components/PageSkeleton";

export default function LanesLoading() {
  return (
    <PageSkeleton
      title="Activity / Lanes"
      active="Activity / Lanes"
      breadcrumb="Lanes"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-bg-elev border border-border-soft p-4 h-24"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div className="xl:col-span-8 rounded-[10px] bg-bg-elev border border-border-soft h-[480px]" />
        <div className="xl:col-span-4 rounded-[10px] bg-bg-elev border border-border-soft h-[480px]" />
      </div>
    </PageSkeleton>
  );
}
