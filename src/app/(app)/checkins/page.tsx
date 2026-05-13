import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getCheckinSummary, listCheckinEvents } from "@/lib/checkins-read";

export default async function CheckinsPage() {
  const session = await requireOrg();
  const summary = getCheckinSummary(session.orgId);
  const events = listCheckinEvents(session.orgId);

  return (
    <AppShell active="Check-ins" breadcrumb="Check-ins">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Check-ins</h1>
            <p className="text-muted text-sm mt-1">
              {summary.totalCheckins === 0
                ? "No check-ins synced yet — turn on Check-ins under Sync settings and run a sync."
                : `${summary.totalCheckins.toLocaleString()} check-ins synced · ${summary.activeEvents} active event${summary.activeEvents === 1 ? "" : "s"} · flag shepherded events under `}
              {summary.totalCheckins > 0 && (
                <Link href="/pco/filters?tab=checkins" className="text-accent hover:underline">
                  Filters → Check-in events
                </Link>
              )}
            </p>
          </div>
        </div>

        {summary.totalCheckins > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted mb-1.5">This week</div>
              <div className="tnum text-2xl font-semibold text-good-soft-fg">
                {summary.checkinsLastWeek.toLocaleString()}
              </div>
              <div className="text-xs text-muted mt-1">
                {summary.peopleLastWeek.toLocaleString()} distinct people
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted mb-1.5">Last 30 days</div>
              <div className="tnum text-2xl font-semibold">
                {summary.checkinsLastMonth.toLocaleString()}
              </div>
              <div className="text-xs text-muted mt-1">
                {summary.peopleLastMonth.toLocaleString()} distinct people
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted mb-1.5">Total people</div>
              <div className="tnum text-2xl font-semibold">
                {summary.totalPeopleEver.toLocaleString()}
              </div>
              <div className="text-xs text-muted mt-1">ever checked in</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted mb-1.5">Shepherded events</div>
              <div className="tnum text-2xl font-semibold text-accent">
                {summary.shepherdedEvents}
              </div>
              <div className="text-xs text-muted mt-1">
                of {summary.activeEvents} active
              </div>
            </Card>
          </div>
        )}

        <div className="rounded-xl border border-border-soft bg-bg-elev overflow-hidden">
          <div className="px-5 py-3 border-b border-border-soft flex items-center justify-between">
            <h2 className="text-sm font-semibold">Check-in events</h2>
            <span className="text-xs text-muted">
              {events.length.toLocaleString()} events · sorted by all-time check-ins
            </span>
          </div>
          {events.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted">
              No check-in events synced yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed min-w-[900px]">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[13%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead className="text-xs text-muted">
                  <tr className="border-b border-border-soft">
                    <th className="text-left font-medium px-5 py-2">Event</th>
                    <th className="text-left font-medium px-5 py-2">Frequency</th>
                    <th className="text-left font-medium px-5 py-2">Tag</th>
                    <th className="text-right font-medium px-5 py-2">
                      Check-ins (30d)
                    </th>
                    <th className="text-right font-medium px-5 py-2">People (30d)</th>
                    <th className="text-right font-medium px-5 py-2">All-time</th>
                    <th className="text-right font-medium px-5 py-2">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr
                      key={e.eventId}
                      className={`border-b border-border-softer hover:bg-bg-elev-2/60 ${
                        e.archivedAt ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-5 py-2.5">
                        <div className="font-medium truncate">
                          {e.name ?? `(unnamed #${e.eventId})`}
                          {e.archivedAt && (
                            <span className="ml-2 text-xs text-muted">
                              archived
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-muted truncate">
                        {e.frequency ?? <span className="text-subtle">—</span>}
                      </td>
                      <td className="px-5 py-2.5">
                        {e.shepherded ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-good-soft-bg text-good-soft-fg font-medium">
                            shepherded
                          </span>
                        ) : (
                          <span className="text-xs text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right tnum">
                        {e.checkinsLast30.toLocaleString()}
                      </td>
                      <td className="px-5 py-2.5 text-right tnum text-muted">
                        {e.peopleLast30.toLocaleString()}
                      </td>
                      <td className="px-5 py-2.5 text-right tnum text-muted">
                        {e.totalCheckins.toLocaleString()}
                      </td>
                      <td className="px-5 py-2.5 text-right tnum text-xs text-muted">
                        {e.lastCheckinAt ? formatDate(e.lastCheckinAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
