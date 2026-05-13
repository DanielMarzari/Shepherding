import { BarChart, ChartCard, DistributionCurve, PieChart } from "./charts";
import {
  type DemographicScope,
  getDemographics,
} from "@/lib/demographics";

/** Four-up demographics row: membership pie, age curve, gender bar,
 *  has-kids bar. Shared across /people, /groups, /teams. */
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
  if (demo.total === 0) {
    return (
      <div className="space-y-3 pt-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted">
            No people in scope yet — once the next sync finishes (which populates
            age + parent flags), demographics will appear here.
          </p>
        </div>
      </div>
    );
  }

  const genderCoverage = Math.round((demo.totalWithGender / demo.total) * 100);
  const ageCoverage = Math.round((demo.totalWithBirthYear / demo.total) * 100);

  return (
    <div className="space-y-3 pt-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted">
          {demo.total.toLocaleString()} people in scope · age coverage{" "}
          {ageCoverage}% · gender coverage {genderCoverage}%
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
        <ChartCard
          title="Parents"
          subtitle="adult sharing a household with a minor"
        >
          <BarChart data={demo.hasKidsBuckets} />
        </ChartCard>
      </div>
    </div>
  );
}
