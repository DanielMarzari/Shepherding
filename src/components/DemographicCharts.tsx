import { BarChart, ChartCard, DistributionCurve, PieChart } from "./charts";
import {
  getDemographics,
  type DemographicScope,
} from "@/lib/demographics";

/** Three-up demographics row: membership pie, age curve, gender bars.
 *  Shared across /people, /groups, /teams. */
export function DemographicCharts({
  orgId,
  scope,
  title,
}: {
  orgId: number;
  scope: DemographicScope;
  title: string;
}) {
  const demo = getDemographics(orgId, scope);
  if (demo.total === 0) return null;

  const genderCoverage =
    demo.total > 0
      ? Math.round((demo.totalWithGender / demo.total) * 100)
      : 0;
  const ageCoverage =
    demo.total > 0
      ? Math.round((demo.totalWithBirthYear / demo.total) * 100)
      : 0;

  return (
    <div className="space-y-3 pt-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted">
          {demo.total.toLocaleString()} people in scope · age coverage{" "}
          {ageCoverage}% · gender coverage {genderCoverage}%
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard
          title="Membership types"
          subtitle={`${demo.membershipBuckets.length} distinct values`}
        >
          <PieChart data={demo.membershipBuckets} maxSlices={6} />
        </ChartCard>
        <ChartCard
          title="Age distribution"
          subtitle="from PCO birthdates · grouped in life stages"
        >
          <DistributionCurve data={demo.ageBuckets} />
        </ChartCard>
        <ChartCard title="Gender" subtitle="self-reported in PCO">
          <BarChart data={demo.genderBuckets} />
        </ChartCard>
      </div>
    </div>
  );
}
