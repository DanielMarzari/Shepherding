/** Skeleton placeholder for chart sections while data streams in via
 *  React Suspense. Mirrors the height + 4-up grid of DemographicCharts
 *  + the 3-up grid of AttendanceTrendCard so the page doesn't jump
 *  when the real content lands. */
export function DemographicChartsSkeleton({ title }: { title: string }) {
  return (
    <div className="space-y-3 pt-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted">loading demographics…</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <ChartSkeleton key={i} h="h-[240px]" />
        ))}
      </div>
    </div>
  );
}

export function AttendanceTrendSkeleton({ scope }: { scope: "groups" | "teams" }) {
  return (
    <div className="space-y-3 pt-3">
      <div>
        <h2 className="text-sm font-semibold">
          {scope === "groups"
            ? "Attendance trends across demographics"
            : "Serving trends across demographics"}
        </h2>
        <p className="text-xs text-muted">loading trends…</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <ChartSkeleton key={i} h="h-[230px]" />
        ))}
      </div>
    </div>
  );
}

function ChartSkeleton({ h }: { h: string }) {
  return (
    <div
      className={`rounded-xl border border-border-soft bg-bg-elev p-4 ${h} animate-pulse`}
    >
      <div className="h-3 w-1/2 bg-bg-elev-2 rounded mb-2" />
      <div className="h-2.5 w-3/4 bg-bg-elev-2/70 rounded mb-4" />
      <div className="h-[140px] bg-bg-elev-2/40 rounded" />
    </div>
  );
}
