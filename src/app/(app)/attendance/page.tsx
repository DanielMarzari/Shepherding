import { AppShell } from "@/components/AppShell";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { buildAttendanceDistribution } from "@/lib/attendance-distribution";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import { AttendanceForm } from "./form";

export default async function AttendancePage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const counts = getClassificationCounts(session.orgId, settings.activityMonths);
  const weekly = settings.weeklyAttendance;

  const expected = counts.shepherded + counts.active + counts.present;
  const ratio = weekly && expected > 0 ? expected / weekly : null;
  const distribution =
    weekly != null ? buildAttendanceDistribution(expected, weekly) : null;

  return (
    <AppShell active="Attendance" breadcrumb="Settings › Attendance">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <div className="text-muted text-xs mb-1">Settings</div>
          <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Tell Shepherding your average weekly Sunday attendance. We use it to compute
            the average attendance frequency and simulate the distribution across your
            people.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Weekly attendance</div>
            <div className="tnum text-2xl font-semibold">
              {weekly == null ? <span className="text-subtle">—</span> : weekly.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">people / week</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Expected attenders</div>
            <div className="tnum text-2xl font-semibold">{expected.toLocaleString()}</div>
            <div className="text-xs text-muted mt-1">shepherded + active + present</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Avg attendance ratio</div>
            <div className="tnum text-2xl font-semibold">
              {ratio == null ? (
                <span className="text-subtle">—</span>
              ) : (
                `1 / ${ratio.toFixed(1)}`
              )}
            </div>
            <div className="text-xs text-muted mt-1">expected ÷ weekly</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Avg interval</div>
            <div className="tnum text-2xl font-semibold">
              {ratio == null ? (
                <span className="text-subtle">—</span>
              ) : (
                `${ratio.toFixed(1)} weeks`
              )}
            </div>
            <div className="text-xs text-muted mt-1">between visits per person</div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Set weekly attendance" />
          <div className="p-5">
            <AttendanceForm initial={weekly} isAdmin={session.role === "admin"} />
          </div>
        </Card>

        {distribution && distribution.buckets.length > 0 && (
          <Card>
            <CardHeader
              title="Simulated frequency distribution"
              right={
                <span className="text-xs text-muted">
                  weekly bucket {distribution.targetWeekly.toLocaleString()} ·
                  total {distribution.expected.toLocaleString()}
                </span>
              }
            />
            <div className="p-5">
              <p className="text-sm text-muted mb-5">
                Anchored at <span className="text-fg tnum">{distribution.targetWeekly.toLocaleString()}</span>{" "}
                people who attend every week, then geometrically tapering down through the
                less-frequent buckets so the column sums to{" "}
                <span className="text-fg tnum">{distribution.expected.toLocaleString()}</span>{" "}
                total. Decay ratio{" "}
                <span className="font-mono text-xs">r = {distribution.decayRatio.toFixed(2)}</span>.
                Implied weekly attendance from the curve:{" "}
                <span className="text-fg tnum">{distribution.impliedWeekly.toLocaleString()}</span>{" "}
                (higher than the &ldquo;every week&rdquo; bucket because some people in the
                tail still attend on any given week).
              </p>
              <DistributionChart distribution={distribution} />
            </div>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">How the math works</h2>
          <p className="text-sm text-muted">
            With <span className="text-fg tnum">{expected.toLocaleString()}</span> expected
            attenders and{" "}
            <span className="text-fg tnum">
              {weekly != null ? weekly.toLocaleString() : "(not set)"}
            </span>{" "}
            actual weekly attenders, the average person attends about{" "}
            <span className="text-fg">
              {ratio == null ? "—" : `1 in every ${ratio.toFixed(1)} weeks`}
            </span>
            . A ratio close to 1 means people come most weeks; a ratio of 4+ suggests many
            of your &quot;expected&quot; people are spotty Sunday attenders.
          </p>
          <p className="text-sm text-muted mt-3">
            The distribution above is a model — once Sunday Check-Ins are synced, this
            simulated curve will be replaced by per-person attendance frequencies.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}

function DistributionChart({
  distribution,
}: {
  distribution: NonNullable<ReturnType<typeof buildAttendanceDistribution>>;
}) {
  // X axis runs frequent → rare: "Every week" on the left, "Once a year"
  // on the right. distribution.buckets is already in that order.
  const ordered = distribution.buckets;
  const max = Math.max(...ordered.map((b) => b.people), 1);

  // SVG geometry
  const W = 720; // viewBox width
  const H = 220;
  const padL = 40;
  const padR = 20;
  const padT = 20;
  const padB = 50;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const points = ordered.map((b, i) => {
    const x = padL + (innerW * i) / (ordered.length - 1);
    const y = padT + innerH - (b.people / max) * innerH;
    return { x, y, b };
  });

  // Smooth Catmull-Rom-ish curve through the points (cubic Bezier per segment)
  function smoothPath(): string {
    if (points.length < 2) return "";
    const cmds: string[] = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
    const tension = 0.45;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] ?? points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) * tension * 0.5;
      const c1y = p1.y + (p2.y - p0.y) * tension * 0.5;
      const c2x = p2.x - (p3.x - p1.x) * tension * 0.5;
      const c2y = p2.y - (p3.y - p1.y) * tension * 0.5;
      cmds.push(
        `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
      );
    }
    return cmds.join(" ");
  }

  const linePath = smoothPath();
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(
    1,
  )} ${(padT + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Attendance frequency distribution">
        <defs>
          <linearGradient id="att-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.30" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* y-axis grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => {
          const y = padT + innerH - g * innerH;
          return (
            <line
              key={g}
              x1={padL}
              x2={W - padR}
              y1={y}
              y2={y}
              stroke="var(--border-soft)"
              strokeDasharray="2 4"
            />
          );
        })}
        {/* fill */}
        <path d={areaPath} fill="url(#att-fill)" />
        {/* line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* points + tooltips on hover via title */}
        {points.map((p) => (
          <g key={p.b.label}>
            <circle cx={p.x} cy={p.y} r="3.5" fill="var(--accent)" />
            <text
              x={p.x}
              y={padT + innerH + 16}
              textAnchor="middle"
              fontSize="10"
              fill="var(--fg-muted)"
            >
              {p.b.label}
            </text>
            <text
              x={p.x}
              y={padT + innerH + 30}
              textAnchor="middle"
              fontSize="9"
              fill="var(--fg-subtle)"
            >
              {p.b.visitsPerYear}/yr
            </text>
            <title>
              {p.b.label} · {p.b.people.toLocaleString()} people ·{" "}
              {(p.b.pct * 100).toFixed(1)}%
            </title>
          </g>
        ))}
      </svg>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {distribution.buckets.map((b) => (
          <div
            key={b.label}
            className="flex items-baseline justify-between rounded border border-border-soft px-2.5 py-1.5"
          >
            <span className="text-muted truncate">{b.label}</span>
            <span className="tnum text-fg ml-2">{b.people.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
