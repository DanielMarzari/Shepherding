import Link from "next/link";
import { Card, CardHeader, Pill, Stat } from "@/components/ui";
import {
  type BoxWhiskerBox,
  BoxWhiskerChart,
  BoxWhiskerRow,
  ScatterChart,
} from "@/components/charts";
import {
  type ConversionStats,
  type EngagementSummary,
  type PipelineBucket,
  type PipelineDim,
  type StagePoint,
  getGroupConverterEngagement,
  getGroupPipeline,
  getGroupStagePoints,
  getServingConverterEngagement,
  getServingPipeline,
  getServingStagePoints,
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

/** Per-person scatter of the two waits side-by-side. Answers "for any
 *  given person, were BOTH waits long, or was one dominant?" — which
 *  the two independent box plots can't show because they treat the
 *  stages as separate populations. Each dot is one (person, group) or
 *  (person, team). Dot size encodes total elapsed time so worst-cases
 *  pop visually. Median crosshairs cut the plot into four quadrants
 *  with labels so the reader sees the pattern without doing inference. */
function StagesScatterCard({
  title,
  subtitle,
  xLabel,
  yLabel,
  points,
}: {
  title: string;
  subtitle: string;
  xLabel: string;
  yLabel: string;
  points: StagePoint[];
}) {
  if (points.length === 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <p className="px-5 py-6 text-sm text-muted text-center">
          Need someone who&apos;s completed all three milestones for at
          least one (person, group/team) pair before this chart fills
          in.
        </p>
      </Card>
    );
  }
  // Median split on each axis — anyone in the top-right quadrant is
  // "slow on both fronts" (real bottleneck); bottom-left is "fast on
  // both fronts" (a clean pipeline).
  const xs = points.map((p) => p.stage1).sort((a, b) => a - b);
  const ys = points.map((p) => p.stage2).sort((a, b) => a - b);
  const xMed = xs[Math.floor(xs.length / 2)];
  const yMed = ys[Math.floor(ys.length / 2)];
  const slowSlow = points.filter(
    (p) => p.stage1 >= xMed && p.stage2 >= yMed,
  ).length;
  const fastFast = points.filter(
    (p) => p.stage1 < xMed && p.stage2 < yMed,
  ).length;
  const adminLag = points.filter(
    (p) => p.stage1 >= xMed && p.stage2 < yMed,
  ).length;
  const showUpLag = points.filter(
    (p) => p.stage1 < xMed && p.stage2 >= yMed,
  ).length;

  return (
    <Card>
      <CardHeader
        title={title}
        right={
          <span className="text-xs text-muted">
            {points.length.toLocaleString()} converters · median split
            at {Math.round(xMed)}d × {Math.round(yMed)}d
          </span>
        }
      />
      <div className="p-5 space-y-3">
        <p className="text-xs text-muted">
          {subtitle} Each dot is one person who completed all three
          milestones; dot size = total time end-to-end (bigger = longer
          journey). The dashed median crosshairs divide the plot into
          four quadrants — see the counts below.
        </p>
        <ScatterChart
          points={points.map((p) => ({
            x: p.stage1,
            y: p.stage2,
            size: p.total,
            label: `${p.label} · total ${p.total}d`,
          }))}
          xLabel={xLabel}
          yLabel={yLabel}
          xSuffix="d"
          ySuffix="d"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          <Stat
            label="Fast → Fast"
            value={fastFast.toLocaleString()}
            valueTone="good"
            delta="clean pipeline: both waits short"
          />
          <Stat
            label="Slow → Fast"
            value={adminLag.toLocaleString()}
            valueTone={adminLag > points.length * 0.25 ? "warn" : "default"}
            delta="admin lag — once added, they show up"
          />
          <Stat
            label="Fast → Slow"
            value={showUpLag.toLocaleString()}
            valueTone={showUpLag > points.length * 0.25 ? "warn" : "default"}
            delta="show-up lag — added quickly, then drift"
          />
          <Stat
            label="Slow → Slow"
            value={slowSlow.toLocaleString()}
            valueTone={slowSlow > points.length * 0.25 ? "warn" : "default"}
            delta="real bottleneck on both ends"
          />
        </div>
      </div>
    </Card>
  );
}

/** Two-stage box-and-whisker. Each stage is one fixed category, so we
 *  reuse the existing categorical chart with two columns. Helps show
 *  WHERE the time goes — admin lag (apply → join, sub → schedule) vs.
 *  the show-up gap that follows. */
function StagesBoxChart({
  title,
  subtitle,
  stageLabels,
  stages,
}: {
  title: string;
  subtitle: string;
  stageLabels: [string, string];
  stages: [ConversionStats, ConversionStats];
}) {
  const boxes = [statsToBox(stages[0]), statsToBox(stages[1])];
  if (boxes.every((b) => b === null)) return null;
  const formatStage = (label: string, s: ConversionStats) =>
    `${label}: n=${s.count} · median ${fmtDays(s.medianDays)} · avg ${fmtDays(s.avgDays)}`;
  return (
    <Card>
      <CardHeader title={title} />
      <div className="p-5 space-y-3">
        <p className="text-xs text-muted">{subtitle}</p>
        <BoxWhiskerChart boxes={boxes} xLabels={stageLabels} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted pt-1">
          <div>{formatStage(stageLabels[0], stages[0])}</div>
          <div>{formatStage(stageLabels[1], stages[1])}</div>
        </div>
      </div>
    </Card>
  );
}

function EngagementCard({
  title,
  subtitle,
  engagement,
  xLabel,
  yLabel = "Attendance %",
}: {
  title: string;
  subtitle: string;
  engagement: EngagementSummary;
  xLabel: string;
  yLabel?: string;
}) {
  if (engagement.points.length === 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <p className="px-5 py-6 text-sm text-muted text-center">
          Not enough post-conversion data yet — converters need at least
          a few events / scheduled plans on the books before this chart
          fills in.
        </p>
      </Card>
    );
  }
  // Quartile split on daysToConvert so we can compare the fast cohort
  // to the slow cohort numerically alongside the scatter.
  const sortedDays = [...engagement.points]
    .map((p) => p.daysToConvert)
    .sort((a, b) => a - b);
  const q25 = sortedDays[Math.floor(sortedDays.length * 0.25)] ?? 0;
  const q75 = sortedDays[Math.floor(sortedDays.length * 0.75)] ?? 0;
  const fast = engagement.points.filter((p) => p.daysToConvert <= q25);
  const slow = engagement.points.filter((p) => p.daysToConvert >= q75);
  const avg = (arr: number[]) =>
    arr.length === 0
      ? null
      : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const fastAvg = avg(fast.map((p) => p.attendancePct));
  const slowAvg = avg(slow.map((p) => p.attendancePct));

  const corr = engagement.correlation;
  const corrLabel =
    corr == null
      ? "—"
      : Math.abs(corr) < 0.1
        ? `≈ 0 (no relationship)`
        : `${corr.toFixed(2)} (${
            corr < 0 ? "fast → more engaged" : "slow → more engaged"
          })`;

  return (
    <Card>
      <CardHeader
        title={title}
        right={
          <span className="text-xs text-muted">
            {engagement.points.length.toLocaleString()} converters
          </span>
        }
      />
      <div className="p-5 space-y-3">
        <p className="text-xs text-muted">
          {subtitle} Dot size = lifespan in the group/team (bigger = stuck
          around longer). Dashed line is the linear trend.
        </p>
        <ScatterChart
          points={engagement.points.map((p) => ({
            x: p.daysToConvert,
            y: p.attendancePct,
            size: p.lifespanDays,
            label: `${p.lifespanDays}d lifespan · ${p.eventsAvailable} events`,
          }))}
          xLabel={xLabel}
          yLabel={yLabel}
          xSuffix="d"
          ySuffix="%"
          trendline
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          <Stat
            label="Fast converters (bottom 25%)"
            value={fastAvg == null ? "—" : `${fastAvg}%`}
            valueTone="good"
            delta={`${fast.length} people · ≤ ${Math.round(q25)}d to convert`}
          />
          <Stat
            label="Slow converters (top 25%)"
            value={slowAvg == null ? "—" : `${slowAvg}%`}
            valueTone={
              slowAvg != null && fastAvg != null && slowAvg < fastAvg - 10
                ? "warn"
                : "default"
            }
            delta={`${slow.length} people · ≥ ${Math.round(q75)}d to convert`}
          />
          <Stat
            label="Correlation"
            value={corrLabel}
            delta="negative = faster converters engage more"
          />
        </div>
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
  const engagement = getServingConverterEngagement(orgId, formId);
  const stagePoints = getServingStagePoints(orgId, formId);
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

      <StagesBoxChart
        title="Serving pipeline · stage spread"
        subtitle="Where the time actually goes: form → added to a team (admin lag — getting them onto the team roster in PCO) vs. added → first served (show-up gap, declined plans). Each stage's full distribution side-by-side."
        stageLabels={["Form → Added to team", "Added to team → First served"]}
        stages={[data.stages.formToAdded, data.stages.addedToServe]}
      />
      <StagesScatterCard
        title="Serving pipeline · per-person stages"
        subtitle="All three milestones (form, added to team, first served) plotted together."
        xLabel="Form → Added to team (days)"
        yLabel="Added to team → First served (days)"
        points={stagePoints}
      />
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
        title="Serving pipeline · trend (last 5 years)"
        subtitle="Cohort grouped by the month the trigger form was submitted. Months with no conversions get a small baseline dot so the timeline reads as a full 5-year span."
        buckets={data.history}
      />
      <EngagementCard
        title="Serving pipeline · engagement"
        subtitle="Do fast converters serve more reliably once they're on the rotation? Y-axis is the % of scheduled plans they actually served (status not declined)."
        engagement={engagement}
        xLabel="Days to first serve"
        yLabel="Plans served %"
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
  const engagement = getGroupConverterEngagement(orgId);
  const stagePoints = getGroupStagePoints(orgId);
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
      <StagesBoxChart
        title="Group pipeline · stage spread"
        subtitle="Where the time actually goes: apply-to-join (waiting for the leader to add them) vs. join-to-first-attended (showing up the first time after joining). Each stage's full distribution side-by-side."
        stageLabels={["Apply → Join", "Join → First attended"]}
        stages={[data.stages.applyToJoin, data.stages.joinToAttend]}
      />
      <StagesScatterCard
        title="Group pipeline · per-person stages"
        subtitle="All three milestones (applied, joined, first attended) plotted together."
        xLabel="Apply → Join (days)"
        yLabel="Join → First attended (days)"
        points={stagePoints}
      />
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
        subtitle="Spread of conversion days within each group. Click a row in the table above to drill in."
        rows={data.byGroup}
      />
      <HistoryBoxChart
        title="Group pipeline · trend (last 5 years)"
        subtitle="Cohort grouped by the month the application was submitted. Months with no conversions get a small baseline dot so the timeline reads as a full 5-year span."
        buckets={data.history}
      />
      <EngagementCard
        title="Group pipeline · engagement"
        subtitle="Do fast converters stay engaged? Y-axis is the % of group events they attended after joining."
        engagement={engagement}
        xLabel="Days to first attended"
      />
    </Card>
  );
}
