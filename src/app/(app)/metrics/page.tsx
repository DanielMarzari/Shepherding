import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import { ThresholdForm } from "./threshold-form";

export default async function MetricsPage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const counts = getClassificationCounts(session.orgId, settings.activityMonths);

  return (
    <AppShell active="Metrics" breadcrumb="Settings › Metrics">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Metrics</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Custom definitions for activity, shepherding, and sync behavior. Tune the
            thresholds to fit how your church measures engagement.
          </p>
        </div>

        {/* Counts */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Total synced</div>
            <div className="tnum text-2xl font-semibold">{counts.total}</div>
            <div className="text-xs text-muted mt-1">people in DB</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Active</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">{counts.active}</div>
            <div className="text-xs text-muted mt-1">
              activity in {settings.activityMonths}mo
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Present</div>
            <div className="tnum text-2xl font-semibold text-accent">{counts.present}</div>
            <div className="text-xs text-muted mt-1">new but quiet</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Inactive</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">{counts.inactive}</div>
            <div className="text-xs text-muted mt-1">slipped away</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Shepherded</div>
            <div className="tnum text-2xl font-semibold">{counts.shepherded}</div>
            <div className="text-xs text-muted mt-1">
              group, team, or Sunday program
            </div>
          </Card>
        </div>

        {/* Thresholds + definitions paired */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Card className="xl:col-span-2">
            <CardHeader title="Thresholds" badge={session.role === "admin" ? null : <Pill tone="muted">read-only</Pill>} />
            <div className="p-5">
              <ThresholdForm
                initialActivity={settings.activityMonths}
                initialSync={settings.syncThresholdMonths}
                initialTracking={settings.activityTrackingMonths}
                initialLapsed={settings.lapsedWeeks}
                initialLapsedTeam={settings.lapsedFromTeamMonths}
                initialLapsedTeamEvents={settings.lapsedFromTeamEvents}
                isAdmin={session.role === "admin"}
              />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-3">Definitions</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium">
                  <span className="text-good-soft-fg">●</span> Active
                </dt>
                <dd className="text-muted text-xs mt-0.5">
                  Any measurable PCO activity in the last{" "}
                  <span className="text-fg">{settings.activityMonths} months</span> — Sunday
                  attendance, group attendance, form submissions, donor records, or PCO
                  record updates.
                </dd>
              </div>
              <div>
                <dt className="font-medium">
                  <span className="text-accent">●</span> Present
                </dt>
                <dd className="text-muted text-xs mt-0.5">
                  Created in PCO within the last{" "}
                  <span className="text-fg">{settings.activityMonths} months</span> but no
                  measurable activity yet. Newcomers in the gap before they engage.
                </dd>
              </div>
              <div>
                <dt className="font-medium">
                  <span className="text-warn-soft-fg">●</span> Inactive
                </dt>
                <dd className="text-muted text-xs mt-0.5">
                  Created more than {settings.activityMonths} months ago AND no activity in
                  the last {settings.activityMonths} months. They have likely slipped away —
                  surface them in the People &gt; Inactive tab.
                </dd>
              </div>
              <div>
                <dt className="font-medium">
                  <span>●</span> Shepherded
                </dt>
                <dd className="text-muted text-xs mt-0.5">
                  Currently in at least one group, team, or Sunday program (kids /
                  student check-in). Independent of active/present/
                  inactive — someone can be Active but not Shepherded (just attending Sundays).
                </dd>
              </div>
            </dl>
            <p className="mt-5 pt-4 border-t border-border-soft text-xs text-muted">
              Group + team membership isn&apos;t synced yet — the Shepherded count is 0 until
              that data is wired up.
            </p>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">Sync behavior</h2>
          <p className="text-sm text-muted">
            On every sync we ask PCO for records updated since the EARLIER of:
          </p>
          <ul className="text-sm text-muted mt-2 space-y-1.5 list-disc list-inside">
            <li>our last successful sync cursor for that resource;</li>
            <li>
              now − <span className="text-fg">{settings.syncThresholdMonths} months</span>{" "}
              (the look-back threshold above).
            </li>
          </ul>
          <p className="text-sm text-muted mt-2">
            On a fresh install with no cursor, we pull everything once. After that, the
            window slides forward but never narrows past the threshold. Lower the threshold
            for cheaper syncs; raise it if PCO admins commonly edit older records.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
