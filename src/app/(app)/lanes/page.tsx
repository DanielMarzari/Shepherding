import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, LaneTag } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getLaneStats, getRecentMovement } from "@/lib/dashboard-read";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import { listShepherds } from "@/lib/shepherds-read";

export default async function LanesPage() {
  const session = await requireOrg();
  return (
    <AppShell active="Activity / Lanes" breadcrumb="Lanes">
      <div className="px-5 md:px-7 py-7">
        <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-muted text-xs mb-1">
              Lane membership & recent transitions
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Activity / Lanes
            </h1>
            <p className="text-muted text-sm mt-1 max-w-xl">
              How people enter, sequence, and dwell in each lane of church
              life. Sections labelled{" "}
              <span className="text-fg">insufficient data</span> aren&apos;t
              wired to a source yet.
            </p>
          </div>
        </div>

        {/* 6 lane stat cards */}
        <Suspense fallback={<LaneCardsSkeleton />}>
          <LaneCards orgId={session.orgId} />
        </Suspense>

        {/* Flow + sequences */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-5">
          <Card className="xl:col-span-8 p-5">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-sm font-semibold">
                Lane flow · last 12 months
              </h2>
              <span className="text-xs text-muted hidden md:inline">
                Sankey of source → next-added lane
              </span>
            </div>
            <p className="text-xs text-muted mb-4">
              Width = number of people who added that next lane after the
              source.
            </p>
            <InsufficientDataBlock
              line1="Lane-transition history isn't logged yet."
              line2="Building this needs a per-person snapshot of which lanes were active each month — once that's wired the sankey here lights up."
            />
          </Card>

          <Card className="xl:col-span-4 p-5">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-sm font-semibold">
                Common journey sequences
              </h2>
              <span className="text-xs text-muted">order &amp; count</span>
            </div>
            <p className="text-xs text-muted mb-4">
              Lanes added in chronological order. People may add more later.
            </p>
            <InsufficientDataBlock
              line1="Same source as the flow above — not wired."
              line2="Once lane snapshots accumulate (a few months at minimum) we can compute the top sequences."
            />
          </Card>
        </div>

        {/* Transitions + sample journeys */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <Card className="xl:col-span-7">
            <Suspense fallback={<TableSkeleton />}>
              <RecentTransitions orgId={session.orgId} />
            </Suspense>
          </Card>

          <Card className="xl:col-span-5 p-5">
            <h2 className="text-sm font-semibold mb-1">
              Heaviest-shepherded people
            </h2>
            <p className="text-xs text-muted mb-4">
              The shepherds with the largest distinct flock — open one to
              see who they cover.
            </p>
            <Suspense fallback={<ListSkeleton rows={5} />}>
              <NotableShepherds orgId={session.orgId} />
            </Suspense>
            <p className="text-xs text-muted mt-4">
              Full activity timelines live on each person&apos;s profile.
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

// ─── Lane cards ───────────────────────────────────────────────────

async function LaneCards({ orgId }: { orgId: number }) {
  const settings = getSyncSettings(orgId);
  const lanes = getLaneStats(orgId, settings.activityMonths);
  const counts = getClassificationCounts(orgId, settings.activityMonths);
  const total = counts.total;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
      {lanes.map((lane) => {
        const pct =
          lane.count != null && total > 0
            ? `${Math.round((lane.count / total) * 100)}%`
            : "—";
        return (
          <Card
            key={lane.key}
            className={`p-4 ${
              lane.unavailable
                ? "border-dashed opacity-70"
                : lane.key === "none"
                  ? "border-dashed"
                  : ""
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <LaneTag laneKey={lane.key} />
              <span className="text-xs text-muted">{pct}</span>
            </div>
            <div className="tnum text-2xl font-semibold mt-2">
              {lane.count == null ? "—" : lane.count.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-0.5">
              {lane.unavailable
                ? "insufficient data"
                : lane.key === "none"
                  ? "no measured activity"
                  : `active in last ${settings.activityMonths} mo`}
            </div>
            {lane.unavailable && lane.reason && (
              <div className="text-[10px] text-subtle mt-2 leading-tight">
                {lane.reason}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function LaneCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="rounded-[10px] bg-bg-elev border border-border-soft p-4 animate-pulse"
        >
          <div className="h-3 w-16 bg-bg-elev-2 rounded mb-3" />
          <div className="h-6 w-12 bg-bg-elev-2/70 rounded" />
          <div className="h-2 w-20 bg-bg-elev-2/50 rounded mt-2" />
        </div>
      ))}
    </div>
  );
}

// ─── Recent transitions table ────────────────────────────────────

async function RecentTransitions({ orgId }: { orgId: number }) {
  const events = getRecentMovement(orgId, 14, 12);
  return (
    <>
      <CardHeader
        title="Lane transitions · last 14 days"
        right={
          <span className="text-xs text-muted">
            {events.length === 0
              ? "no changes"
              : `${events.length} change${events.length === 1 ? "" : "s"}`}
          </span>
        }
      />
      {events.length === 0 ? (
        <InsufficientDataBlock
          line1="No group / team membership changes in the last 14 days."
          line2="If you just synced for the first time, joined_at backfills on the next services + groups sync."
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Person</th>
              <th className="text-left font-medium px-5 py-2">Change</th>
              <th className="text-right font-medium px-5 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr
                key={`${e.personId}-${e.at}-${i}`}
                className="border-b border-border-softer hover:bg-bg-elev-2/60"
              >
                <td className="px-5 py-2.5">
                  <Link
                    href={`/people/${e.personId}`}
                    className="hover:text-accent"
                  >
                    {e.personName}
                  </Link>
                </td>
                <td className="px-5 py-2.5 text-muted">
                  {e.text.replace(`${e.personName} `, "")}
                </td>
                <td className="px-5 py-2.5 text-muted text-right tnum">
                  {new Date(e.at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ─── Heaviest shepherded ──────────────────────────────────────────

async function NotableShepherds({ orgId }: { orgId: number }) {
  const shepherds = listShepherds(orgId).slice(0, 6);
  if (shepherds.length === 0) {
    return (
      <InsufficientDataBlock
        line1="No leaders detected yet."
        line2="Once group / team leadership is synced, the heaviest-loaded shepherds will show here."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {shepherds.map((s) => (
        <li key={s.personId}>
          <Link
            href={`/people/${s.personId}`}
            className="block rounded border border-border-soft p-3 hover:bg-bg-elev-2/60 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm">{s.fullName}</span>
              <span className="text-xs text-muted tnum">
                {s.totalLed} unit{s.totalLed === 1 ? "" : "s"}
              </span>
            </div>
            <div className="text-xs text-muted">
              {s.groupsLed.length > 0 && (
                <span>
                  {s.groupsLed.length} group{s.groupsLed.length === 1 ? "" : "s"}
                </span>
              )}
              {s.groupsLed.length > 0 && s.teamsLed.length > 0 && " · "}
              {s.teamsLed.length > 0 && (
                <span>
                  {s.teamsLed.length} team{s.teamsLed.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─── Skeletons + shared ──────────────────────────────────────────

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <li
          key={i}
          className="rounded border border-border-soft p-3 animate-pulse"
        >
          <div className="h-3 w-32 bg-bg-elev-2/70 rounded mb-2" />
          <div className="h-2 w-24 bg-bg-elev-2/50 rounded" />
        </li>
      ))}
    </ul>
  );
}

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="px-5 pt-4 pb-3 border-b border-border-soft">
        <div className="h-3 w-40 bg-bg-elev-2 rounded" />
      </div>
      <div className="p-5 space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-3 w-full bg-bg-elev-2/50 rounded" />
        ))}
      </div>
    </div>
  );
}

function InsufficientDataBlock({
  line1,
  line2,
}: {
  line1: string;
  line2?: string;
}) {
  return (
    <div className="px-2 py-7 text-center">
      <div className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-bg-elev-2 text-subtle mb-2">
        Insufficient data
      </div>
      <p className="text-sm text-muted">{line1}</p>
      {line2 && <p className="text-xs text-subtle mt-1">{line2}</p>}
    </div>
  );
}
