import { PageSkeleton } from "@/components/PageSkeleton";

export default function ShepherdOversightLoading() {
  return (
    <PageSkeleton active="Shepherd team" breadcrumb="Shepherd team">
      <div className="px-5 md:px-7 py-7 space-y-6 animate-pulse max-w-5xl">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-bg-elev-2/60" />
          <div className="flex-1 space-y-2">
            <div className="h-7 w-56 bg-bg-elev-2/60 rounded" />
            <div className="h-4 w-72 bg-bg-elev-2/40 rounded" />
          </div>
        </div>
        <div className="h-[18px] w-[360px] bg-bg-elev-2/60 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="min-h-[104px] rounded-lg border border-border-soft bg-bg-elev-2/40"
            />
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
