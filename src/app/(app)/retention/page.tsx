import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getRetentionCohorts } from "@/lib/retention-read";

export default async function RetentionPage() {
  const session = await requireOrg();
  const { cohorts, overallJoined, overallRetained } = getRetentionCohorts(
    session.orgId,
  );
  const overallPct =
    overallJoined > 0 ? Math.round((overallRetained / overallJoined) * 100) : 0;
  // Newest cohorts first for the table.
  const rows = [...cohorts].reverse();

  return (
    <AppShell active="Retention" breadcrumb="Retention">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Retention</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Of the people whose PCO profile was created in a given year, how
            many are still active today (in a group/team, or active/present by
            recent activity). A rough read on how well each year&apos;s
            newcomers stuck — newer years naturally trend higher since they
            haven&apos;t had as long to drift.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Overall retained</div>
            <div className="tnum text-2xl font-semibold">{overallPct}%</div>
            <div className="text-xs text-muted mt-1">
              {overallRetained.toLocaleString()} of{" "}
              {overallJoined.toLocaleString()} ever added
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Cohorts</div>
            <div className="tnum text-2xl font-semibold">{cohorts.length}</div>
            <div className="text-xs text-muted mt-1">years with new profiles</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">People tracked</div>
            <div className="tnum text-2xl font-semibold">
              {overallJoined.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">profiles with a created date</div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-border-soft flex items-center justify-between">
            <h2 className="text-sm font-semibold">Retention by join year</h2>
            <span className="text-xs text-muted">retained ÷ joined</span>
          </div>
          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted">
              No profiles with a created date yet — run a PCO sync.
            </div>
          ) : (
            <ul className="divide-y divide-border-softer">
              {rows.map((c) => (
                <li key={c.year} className="px-5 py-3 flex items-center gap-4">
                  <span className="tnum text-sm font-medium w-12 shrink-0">
                    {c.year}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="h-3 rounded-full bg-bg-elev-2 overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full"
                        style={{ width: `${c.pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="tnum text-sm font-medium w-12 text-right shrink-0">
                    {c.pct}%
                  </span>
                  <span className="tnum text-xs text-muted w-28 text-right shrink-0">
                    {c.retained.toLocaleString()} / {c.joined.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs text-subtle max-w-2xl">
          &ldquo;Joined&rdquo; uses the PCO profile creation date as a proxy —
          when someone first entered your system, which isn&apos;t always when
          they first showed up. A truer cohort (first attendance / first form)
          is a future enhancement.
        </p>
      </div>
    </AppShell>
  );
}
