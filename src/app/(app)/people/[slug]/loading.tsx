import { PageSkeleton } from "@/components/PageSkeleton";

export default function PersonLoading() {
  return (
    <PageSkeleton active="People" breadcrumb="People › …">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-bg-elev-2/60" />
            <div className="space-y-2">
              <div className="h-6 w-48 bg-bg-elev-2/60 rounded" />
              <div className="h-3 w-32 bg-bg-elev-2/40 rounded" />
            </div>
          </div>
          <div className="rounded-[10px] bg-bg-elev border border-border-soft h-40" />
          <div className="rounded-[10px] bg-bg-elev border border-border-soft h-64" />
          <div className="rounded-[10px] bg-bg-elev border border-border-soft h-56" />
        </div>
        <aside>
          <div className="rounded-[10px] bg-bg-elev border border-border-soft h-[480px]" />
        </aside>
      </div>
    </PageSkeleton>
  );
}
