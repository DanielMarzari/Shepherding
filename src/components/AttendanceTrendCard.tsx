import { ChartCard, MultiLineChart } from "./charts";
import {
  getAttendanceTrend,
  type TrendDimension,
  type TrendScope,
} from "@/lib/attendance-trends";
import type { DemographicScope } from "@/lib/demographics";

/** Three side-by-side trend charts: attendance over 12 months broken
 *  by age band / gender / parent status. Used at the bottom of
 *  /groups and /teams. `trendScope` picks the data source (group
 *  attendance vs. team serving). `filterScope` narrows to a specific
 *  group/team/type, or stays at the cohort default. */
export function AttendanceTrendCard({
  orgId,
  trendScope,
  filterScope,
  months = 12,
}: {
  orgId: number;
  trendScope: TrendScope;
  filterScope: DemographicScope;
  months?: number;
}) {
  const dims: Array<{ dimension: TrendDimension; title: string; subtitle: string }> = [
    {
      dimension: "ageBand",
      title: trendScope === "groups" ? "Group attendance by age" : "Serving by age",
      subtitle: "% of each age band participating per month",
    },
    {
      dimension: "gender",
      title:
        trendScope === "groups" ? "Group attendance by gender" : "Serving by gender",
      subtitle: "% of each gender participating per month",
    },
    {
      dimension: "hasKids",
      title:
        trendScope === "groups"
          ? "Group attendance by parent status"
          : "Serving by parent status",
      subtitle: "% of parents / non-parents / minors participating",
    },
  ];

  return (
    <div className="space-y-3 pt-3">
      <div>
        <h2 className="text-sm font-semibold">
          {trendScope === "groups"
            ? "Attendance trends across demographics"
            : "Serving trends across demographics"}
        </h2>
        <p className="text-xs text-muted">
          Distinct people{" "}
          {trendScope === "groups"
            ? "attending a group event"
            : "on a confirmed plan"}{" "}
          per month, broken down by demographic line.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {dims.map((d) => {
          const trend = getAttendanceTrend(
            orgId,
            trendScope,
            d.dimension,
            filterScope,
            months,
          );
          const xLabels = trend.months.map(formatMonthLabel);
          return (
            <ChartCard
              key={d.dimension}
              title={d.title}
              subtitle={d.subtitle}
            >
              <MultiLineChart
                series={trend.series.map((s) => ({
                  label: s.label,
                  values: s.values,
                  cohortSize: s.cohortSize,
                }))}
                xLabels={xLabels}
                yMode="percent"
              />
            </ChartCard>
          );
        })}
      </div>
    </div>
  );
}

function formatMonthLabel(yyyymm: string): string {
  const m = yyyymm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return yyyymm;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const monthShort = date.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return `${monthShort} '${String(year).slice(-2)}`;
}
