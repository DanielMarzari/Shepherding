import { Card, CardHeader, Stat } from "@/components/ui";
import { MultiLineChart } from "@/components/charts";
import {
  type ConversionStats,
  type PipelineBucket,
  type PipelineDim,
  getGroupPipeline,
  getServingPipeline,
  recentMonthKeys,
} from "@/lib/pipeline-read";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function shortMonthLabel(k: string): string {
  // "YYYY-MM" -> "Jan '20"
  const [y, m] = k.split("-");
  const mm = Number(m);
  return `${MONTH_LABELS[mm - 1] ?? m} '${y.slice(2)}`;
}

function fmtDays(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1.5) return `${n.toFixed(1)}d`;
  return `${Math.round(n)}d`;
}

// ─── Skeletons ────────────────────────────────────────────────────

export function PipelineSectionSkeleton({ title }: { title: string }) {
  return (
    <Card className="p-5 animate-pulse space-y-4">
      <div className="h-3.5 w-48 bg-bg-elev-2 rounded" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-20 rounded-[10px] bg-bg-elev-2/60"
          />
        ))}
      </div>
      <div className="h-[200px] bg-bg-elev-2/40 rounded" />
      <span className="sr-only">Loading {title}…</span>
    </Card>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────

function StatStrip({ stats }: { stats: ConversionStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat
        label="Converters"
        value={stats.count.toLocaleString()}
        delta="people who completed the pipeline"
      />
      <Stat
        label="Median time"
        value={fmtDays(stats.medianDays)}
        valueTone="accent"
        delta="50% convert faster than this"
      />
      <Stat
        label="Average time"
        value={fmtDays(stats.avgDays)}
        delta="skewed by outliers"
      />
      <Stat
        label="Slow tail (75th)"
        value={fmtDays(stats.p75Days)}
        valueTone={stats.p75Days && stats.p75Days > 60 ? "warn" : "default"}
        delta="3 in 4 convert by this point"
      />
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  cap = 20,
}: {
  title: string;
  rows: PipelineDim[];
  cap?: number;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <p className="px-5 py-6 text-sm text-muted text-center">
          No conversions found in the data yet.
        </p>
      </Card>
    );
  }
  const shown = rows.slice(0, cap);
  return (
    <Card>
      <CardHeader
        title={title}
        right={
          <span className="text-xs text-muted">
            {rows.length.toLocaleString()} segment
            {rows.length === 1 ? "" : "s"}
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Segment</th>
              <th className="text-right font-medium px-5 py-2">Converters</th>
              <th className="text-right font-medium px-5 py-2">Median</th>
              <th className="text-right font-medium px-5 py-2">Avg</th>
              <th className="text-right font-medium px-5 py-2">25th – 75th</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.key}
                className="border-b border-border-softer hover:bg-bg-elev-2/60"
              >
                <td className="px-5 py-2.5">
                  <span className="font-medium truncate">{r.name}</span>
                </td>
                <td className="px-5 py-2.5 text-right tnum">
                  {r.stats.count.toLocaleString()}
                </td>
                <td className="px-5 py-2.5 text-right tnum">
                  {fmtDays(r.stats.medianDays)}
                </td>
                <td className="px-5 py-2.5 text-right tnum text-muted">
                  {fmtDays(r.stats.avgDays)}
                </td>
                <td className="px-5 py-2.5 text-right tnum text-muted">
                  {fmtDays(r.stats.p25Days)} – {fmtDays(r.stats.p75Days)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > cap && (
          <div className="px-5 py-2.5 text-xs text-muted text-center">
            + {(rows.length - cap).toLocaleString()} more not shown
          </div>
        )}
      </div>
    </Card>
  );
}

function HistoryChart({
  title,
  subtitle,
  buckets,
}: {
  title: string;
  subtitle: string;
  buckets: PipelineBucket[];
}) {
  const xLabels = buckets.map((b) => shortMonthLabel(b.month));
  const medians = buckets.map((b) =>
    b.stats.medianDays === null ? 0 : Math.round(b.stats.medianDays),
  );
  const counts = buckets.map((b) => b.stats.count);
  const hasAny = counts.some((c) => c > 0);
  return (
    <Card>
      <CardHeader
        title={title}
        right={
          <span className="text-xs text-muted">{xLabels.length} months</span>
        }
      />
      <div className="p-5 space-y-3">
        <p className="text-xs text-muted">
          {subtitle} Months with no conversions read as zero — gaps in the
          line are inactivity, not zero-day conversions.
        </p>
        {hasAny ? (
          <MultiLineChart
            series={[
              {
                label: "Median days to convert",
                values: medians,
              },
            ]}
            xLabels={xLabels}
            height={220}
          />
        ) : (
          <p className="text-sm text-muted text-center py-8">
            No history yet — pipeline data builds up over time.
          </p>
        )}
      </div>
    </Card>
  );
}

// ─── Pipelines ────────────────────────────────────────────────────

export async function ServingPipelineSection({ orgId }: { orgId: number }) {
  const data = getServingPipeline(orgId);
  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Serving pipeline</h2>
        <p className="text-sm text-muted mt-0.5">
          From a person&apos;s most recent form submission to their first
          time scheduled on a serving plan — per service type. Pipelines
          longer than a year are excluded so old submissions don&apos;t
          inflate the numbers.
        </p>
      </div>
      <StatStrip stats={data.overall} />
      <BreakdownTable title="By service type" rows={data.byServiceType} />
      <HistoryChart
        title="Serving pipeline · trend"
        subtitle="Cohort grouped by the month the trigger form was submitted."
        buckets={data.history}
      />
    </Card>
  );
}

export async function GroupPipelineSection({ orgId }: { orgId: number }) {
  const data = getGroupPipeline(orgId);
  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Group pipeline</h2>
        <p className="text-sm text-muted mt-0.5">
          From a group application to that person&apos;s first attended
          event in that group. Broken down per group type and per group.
        </p>
      </div>
      <StatStrip stats={data.overall} />
      <BreakdownTable title="By group type" rows={data.byGroupType} />
      <BreakdownTable title="By group" rows={data.byGroup} cap={25} />
      <HistoryChart
        title="Group pipeline · trend"
        subtitle="Cohort grouped by the month the application was submitted."
        buckets={data.history}
      />
    </Card>
  );
}

// Re-export so the page only has to import from one place.
export { recentMonthKeys };
