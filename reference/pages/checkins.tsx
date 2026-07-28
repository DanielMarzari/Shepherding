import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getCheckinSummary, listCheckinEvents } from "@/lib/checkins-read";

export default async function CheckinsPage() {
  const session = await requireOrg();
  // Render the shell synchronously; everything heavy streams in via
  // <Suspense> below so users see the page outline immediately instead
  // of staring at a blank screen while we scan 265k check-in rows.
  return (
    <AppShell active="Check-ins" breadcrumb="Check-ins">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Check-ins</h1>
            <p className="text-muted text-sm mt-1">
              Tag events as Kid / Adult / Ignore under{" "}
              <Link
                href="/pco/filters?tab=checkins"
                className="text-accent hover:underline"
              >
                Filters → Check-in events
              </Link>
              . Ignored events don&apos;t appear here.
            </p>
          </div>
        </div>

        <Suspense fallback={<SummarySkeleton />}>
          <CheckinSummaryCards orgId={session.orgId} />
        </Suspense>

        <Suspense fallback={<EventsTableSkeleton />}>
          <CheckinEventsTable orgId={session.orgId} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function CheckinSummaryCards({ orgId }: { orgId: number }) {
  const summary = getCheckinSummary(orgId);
  if (summary.totalCheckins === 0) {
    return (
      <div className="text-sm text-muted">
        No check-ins synced yet — turn on Check-ins under Sync settings and run a
        sync.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card className="p-4">
        <div className="text-xs text-muted mb-1.5">This week</div>
        <div className="tnum text-2xl font-semibold text-good-soft-fg">
          {summary.peopleLastWeek.toLocaleString()}
        </div>
        <div className="text-xs text-muted mt-1">
          distinct people · {summary.checkinsLastWeek.toLocaleString()} check-ins
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted mb-1.5">Last 30 days</div>
        <div className="tnum text-2xl font-semibold">
          {summary.peopleLastMonth.toLocaleString()}
        </div>
        <div className="text-xs text-muted mt-1">
          distinct people · {summary.checkinsLastMonth.toLocaleString()} check-ins
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted mb-1.5">Total people</div>
        <div className="tnum text-2xl font-semibold">
          {summary.totalPeopleEver.toLocaleString()}
        </div>
        <div className="text-xs text-muted mt-1">
          distinct people ever checked in
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted mb-1.5">Ignored events</div>
        <div className="tnum text-2xl font-semibold text-warn-soft-fg">
          {summary.excludedEvents}
        </div>
        <div className="text-xs text-muted mt-1">
          of {summary.activeEvents} active · hidden from this page
        </div>
      </Card>
    </div>
  );
}

async function CheckinEventsTable({ orgId }: { orgId: number }) {
  const events = listCheckinEvents(orgId);
  return (
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
              <col className="w-[34%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="text-xs text-muted">
              <tr className="border-b border-border-soft">
                <th className="text-left font-medium px-5 py-2">Event</th>
                <th className="text-left font-medium px-5 py-2">Frequency</th>
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
  );
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border-soft bg-bg-elev p-4 h-[88px] animate-pulse"
        />
      ))}
    </div>
  );
}

function EventsTableSkeleton() {
  return (
    <div className="rounded-xl border border-border-soft bg-bg-elev h-[280px] animate-pulse" />
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
