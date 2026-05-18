import { AttendanceTrendCard } from "./AttendanceTrendCard";
import { DemographicCharts } from "./DemographicCharts";
import type { TrendScope } from "@/lib/attendance-trends";
import type { DemographicScope } from "@/lib/demographics";

/** Async wrappers around the chart cards so they can be dropped inside
 *  a <Suspense> boundary. Without `async`, the component renders
 *  synchronously and Suspense never sees a fallback opportunity — the
 *  shell waits for the whole page. With async, Next streams the shell
 *  immediately and the charts arrive once their queries finish. */

export async function AsyncDemographicCharts({
  orgId,
  scope,
  title,
}: {
  orgId: number;
  scope: DemographicScope;
  title: string;
}) {
  return <DemographicCharts orgId={orgId} scope={scope} title={title} />;
}

export async function AsyncAttendanceTrendCard({
  orgId,
  trendScope,
  filterScope,
  months,
}: {
  orgId: number;
  trendScope: TrendScope;
  filterScope: DemographicScope;
  months?: number;
}) {
  return (
    <AttendanceTrendCard
      orgId={orgId}
      trendScope={trendScope}
      filterScope={filterScope}
      months={months}
    />
  );
}
