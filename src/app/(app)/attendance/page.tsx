import { AppShell } from "@/components/AppShell";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { buildAttendanceDistribution } from "@/lib/attendance-distribution";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import { AttendanceForm } from "./form";
import { DistributionChart } from "./distribution-chart";

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

