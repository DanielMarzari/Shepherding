import { AppShell } from "@/components/AppShell";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import { AttendanceForm } from "./form";

export default async function AttendancePage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const counts = getClassificationCounts(session.orgId, settings.activityMonths);
  const weekly = settings.weeklyAttendance;

  // Active denominator = anyone we'd reasonably expect to attend Sunday
  // (shepherded + active + present). Excludes inactive.
  const expected = counts.shepherded + counts.active + counts.present;
  const ratio = weekly && expected > 0 ? expected / weekly : null;
  const intervalWeeks = ratio ? ratio : null;

  return (
    <AppShell active="Attendance" breadcrumb="Settings › Attendance">
      <div className="px-5 md:px-7 py-7 max-w-5xl space-y-6">
        <div>
          <div className="text-muted text-xs mb-1">Settings</div>
          <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Tell Shepherding your average weekly Sunday attendance. We use it to compute
            the average attendance frequency across your active people — answering
            &ldquo;on average, how often does an active person show up?&rdquo;
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
              {intervalWeeks == null ? (
                <span className="text-subtle">—</span>
              ) : (
                `${intervalWeeks.toFixed(1)} weeks`
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

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">How the math works</h2>
          <p className="text-sm text-muted">
            With <span className="text-fg tnum">{expected.toLocaleString()}</span> people
            we&apos;d reasonably expect to show up some Sunday and{" "}
            <span className="text-fg tnum">
              {weekly != null ? weekly.toLocaleString() : "(not set)"}
            </span>{" "}
            actually showing up on a given week, the average active person attends about{" "}
            <span className="text-fg">
              {ratio == null ? "—" : `1 in every ${ratio.toFixed(1)} weeks`}
            </span>
            . A ratio close to 1 means people come most weeks; a ratio of 4+ means many of
            your &quot;active&quot; people are spotty Sunday attenders.
          </p>
          <p className="text-sm text-muted mt-3">
            Once Sunday Check-Ins are synced from PCO, this rough average will be replaced
            with per-person attendance frequencies.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
