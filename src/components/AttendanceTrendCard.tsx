import { ChartCard, MultiLineChart } from "./charts";
import {
  getAttendanceTrend,
  type TrendDimension,
  type TrendScope,
} from "@/lib/attendance-trends";

/** Three side-by-side trend charts: attendance over the last 12 months
 *  broken by gender, by age band, by parent status. Used at the bottom
 *  of /groups and /teams. */
export function AttendanceTrendCard({
  orgId,
  scope,
  months = 12,
}: {
  orgId: number;
  scope: TrendScope;
  months?: number;
}) {
  const dims: Array<{ dimension: TrendDimension; title: string; subtitle: string }> = [
    {
      dimension: "ageBand",
      title: scope === "groups" ? "Group attendance by age" : "Serving by age",
      subtitle: "distinct people per month, last 12mo",
    },
    {
      dimension: "gender",
      title:
        scope === "groups" ? "Group attendance by gender" : "Serving by gender",
      subtitle: "distinct people per month",
    },
    {
      dimension: "hasKids",
      title:
        scope === "groups"
          ? "Group attendance by parent status"
          : "Serving by parent status",
      subtitle: "minors / parents / non-parents",
    },
  ];

  return (
    <div className="space-y-3 pt-3">
      <div>
        <h2 className="text-sm font-semibold">
          {scope === "groups"
            ? "Attendance trends across demographics"
            : "Serving trends across demographics"}
        </h2>
        <p className="text-xs text-muted">
          Distinct people {scope === "groups" ? "attending a group event" : "on a confirmed plan"} per month, broken
          down by demographic line. Sliced from synced PCO data — no third-party tracking.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {dims.map((d) => {
          const trend = getAttendanceTrend(orgId, scope, d.dimension, months);
          const xLabels = trend.months.map(formatMonthLabel);
          return (
            <ChartCard
              key={d.dimension}
              title={d.title}
              subtitle={d.subtitle}
            >
              <MultiLineChart series={trend.series} xLabels={xLabels} />
            </ChartCard>
          );
        })}
      </div>
    </div>
  );
}

/** "2026-05" → "May '26" — short enough for x-axis labels. */
function formatMonthLabel(yyyymm: string): string {
  const m = yyyymm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return yyyymm;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const monthShort = date.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return `${monthShort} '${String(year).slice(-2)}`;
}
