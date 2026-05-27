import Link from "next/link";
import { Card, CardHeader, Pill, Stat } from "@/components/ui";
import {
  type BoxWhiskerBox,
  BoxWhiskerChart,
  BoxWhiskerRow,
} from "@/components/charts";
import {
  type ConversionStats,
  type PipelineBucket,
  type PipelineDim,
  getGroupPipeline,
  getServingPipeline,
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
  const [y, m] = k.split("-");
  const mm = Number(m);
  return `${MONTH_LABELS[mm - 1] ?? m} '${y.slice(2)}`;
}

function fmtDays(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1.5) return `${n.toFixed(1)}d`;
  return `${Math.round(n)}d`;
}

function statsToBox(s: ConversionStats): BoxWhiskerBox | null {
  if (
    s.count === 0 ||
    s.minDays === null ||
    s.p25Days === null ||
    s.medianDays === null ||
    s.p75Days === null ||
    s.maxDays === null
  ) {
    return null;
  }
  return {
    min: s.minDays,
    p25: s.p25Days,
    median: s.medianDays,
    p75: s.p75Days,
    max: s.maxDays,
    count: s.count,
  };
}

// ─── Skeletons ────────────────────────────────────────────────────

export function PipelineSectionSkeleton({ title }: { title: string }) {
  return (
    <Card className="p-5 animate-pulse space-y-4">
      <div className="h-3.5 w-48 bg-bg-elev-2 rounded" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-[10px] bg-bg-elev-2/60" />
        ))}
      </div>
      <div className="h-[240px] bg-bg-elev-2/40 rounded" />
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
  /** When set, each row links to `${rowHref}/${row.key}` — used to drill
   *  into the per-group / per-service-type person list. */
  rowHref,
}: {
  title: string;
  rows: PipelineDim[];
  cap?: number;
  rowHref?: string;
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
  const scaleMax = Math.max(
    1,
    ...rows.flatMap((r) => (r.stats.maxDays !== null ? [r.stats.maxDays] : [])),
  );
  return (
    <Card>
      <CardHeader
        title={title}
        right={
          <span className="text-xs text-muted">
            {rows.length.toLocaleString()} segment
            {rows.length === 1 ? "" : "s"} · scale 0 – {Math.round(scaleMax)}d
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Segment</th>
              <th className="text-right font-medium px-5 py-2">n</th>
              <th className="text-right font-medium px-5 py-2">Median</th>
              <th className="text-left font-medium px-5 py-2 w-[260px]">
                Distribution
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const box = statsToBox(r.stats);
              const href = rowHref
                ? `${rowHref}/${encodeURIComponent(r.key)}`
                : null;
              const NameCell = href ? (
                <Link
                  href={href}
                  className="font-medium truncate block max-w-[260px] hover:text-accent"
                  title={r.name}
                >
                  {r.name}
                </Link>
              ) : (
                <span
                  className="font-medium truncate block max-w-[260px]"
                  title={r.name}
                >
                  {r.name}
                </span>
              );
              return (
                <tr
                  key={r.key}
                  className={`border-b border-border-softer ${
                    href
                      ? "hover:bg-bg-elev-2/60 cursor-pointer"
                      : "hover:bg-bg-elev-2/60"
                  }`}
                >
                  <td className="px-5 py-2.5">{NameCell}</td>
                  <td className="px-5 py-2.5 text-right tnum">
                    {r.stats.count.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right tnum">
                    {fmtDays(r.stats.medianDays)}
                  </td>
                  <td className="px-5 py-2.5">
                    {box ? (
                      <div title={`${Math.round(box.min)}d – ${Math.round(box.max)}d (median ${Math.round(box.median)}d)`}>
                        <BoxWhiskerRow box={box} scaleMax={scaleMax} />
                      </div>
                    ) : (
                      <span className="text-xs text-subtle">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
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

/** Same BoxWhiskerChart shape but one box per CATEGORY (service type,
 *  group type, group) instead of per month. Helps spot e.g. one group
 *  type with a 200-day median tail dragging the overall average. */
function CategoricalBoxChart({
  title,
  rows,
  subtitle,
  cap = 25,
}: {
  title: string;
  rows: PipelineDim[];
  subtitle?: string;
  cap?: number;
}) {
  const filtered = rows
    .filter((r) => statsToBox(r.stats) !== null)
    .slice(0, cap);
  if (filtered.length === 0) return null;
  const boxes = filtered.map((r) => statsToBox(r.stats));
  const xLabels = filtered.map((r) => r.name);
  return (
    <Card>
      <CardHeader
        title={title}
        right={
          <span className="text-xs text-muted">
            {filtered.length.toLocaleString()} of{" "}
            {rows.length.toLocaleString()}
          </span>
        }
      />
      <div className="p-5 space-y-3">
        {subtitle && (
          <p className="text-xs text-muted">
            {subtitle} Each box is one segment — whiskers show min / max
            days, the box is the 25th–75th percentile, white tick is the
            median.
          </p>
        )}
        <BoxWhiskerChart boxes={boxes} xLabels={xLabels} rotateLabels />
      </div>
    </Card>
  );
}

function HistoryBoxChart({
  title,
  subtitle,
  buckets,
}: {
  title: string;
  subtitle: string;
  buckets: PipelineBucket[];
}) {
  const xLabels = buckets.map((b) => shortMonthLabel(b.month));
  const boxes = buckets.map((b) => statsToBox(b.stats));
  const hasAny = boxes.some((b) => b !== null);
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
          {subtitle} Each box is a monthly cohort — whiskers show min /
          max days, the box is the 25th–75th percentile, and the white
          tick is the median. Empty months simply had no conversions.
        </p>
        {hasAny ? (
          <BoxWhiskerChart boxes={boxes} xLabels={xLabels} />
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

export async function ServingPipelineSection({
  orgId,
  formId,
}: {
  orgId: number;
  formId: string | null;
}) {
  const data = getServingPipeline(orgId, formId);
  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Serving pipeline</h2>
        <p className="text-sm text-muted mt-0.5">
          From the trigger form below to a person&apos;s first time
          scheduled on a serving plan — per service type. Pipelines
          longer than a year are excluded so old submissions don&apos;t
          inflate the numbers.
        </p>
        <div className="mt-2 text-xs">
          {data.formConfigured ? (
            <span className="text-muted">
              Trigger:{" "}
              <span className="text-fg font-medium">{data.formName}</span>{" "}
              ·{" "}
              <Link
                href="/metrics"
                className="text-accent hover:underline"
              >
                change
              </Link>
            </span>
          ) : (
            <span className="text-warn-soft-fg">
              No serving-interest form configured —{" "}
              <Link
                href="/metrics"
                className="text-accent hover:underline"
              >
                pick one on /metrics
              </Link>
              . Pipeline is using <em>any</em> form submission until you do.
            </span>
          )}
        </div>
      </div>

      <StatStrip stats={data.overall} />

      {data.formConfigured && (
        <UntriggeredCard untriggered={data.untriggered} />
      )}

      <BreakdownTable
        title="By service type"
        rows={data.byServiceType}
        rowHref="/pipeline/serving"
      />
      <CategoricalBoxChart
        title="Serving pipeline · by service type"
        subtitle="Spread of conversion days within each service type."
        rows={data.byServiceType}
      />
      <HistoryBoxChart
        title="Serving pipeline · trend"
        subtitle="Cohort grouped by the month the trigger form was submitted."
        buckets={data.history}
      />
    </Card>
  );
}

function UntriggeredCard({
  untriggered,
}: {
  untriggered: { count: number };
}) {
  if (untriggered.count === 0) {
    return (
      <Card className="p-4 text-sm text-muted">
        <span className="text-good-soft-fg font-medium">
          ✓ Every server submitted the form first.
        </span>{" "}
        No one started serving without going through the configured
        pipeline.
      </Card>
    );
  }
  return (
    <Card className="p-4 flex items-baseline justify-between gap-4">
      <div className="text-sm">
        <span className="text-warn-soft-fg font-medium">
          {untriggered.count.toLocaleString()}
        </span>{" "}
        <span className="text-muted">
          started serving without ever submitting the configured form —
          these people bypass the pipeline entirely.
        </span>
      </div>
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
      <CategoricalBoxChart
        title="Group pipeline · by group type"
        subtitle="Spread of conversion days within each group type."
        rows={data.byGroupType}
      />
      <BreakdownTable
        title="By group"
        rows={data.byGroup}
        cap={25}
        rowHref="/pipeline/group"
      />
      <CategoricalBoxChart
        title="Group pipeline · by group"
        subtitle="Spread of conversion days within each group. Click a row above to drill in."
        rows={data.byGroup}
      />
      <HistoryBoxChart
        title="Group pipeline · trend"
        subtitle="Cohort grouped by the month the application was submitted."
        buckets={data.history}
      />
    </Card>
  );
}
