import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { PieChart } from "@/components/charts";
import { requireOrg } from "@/lib/auth";
import { getOrgSnapshot } from "@/lib/dashboard-refresh";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import { listGroups } from "@/lib/community-lane";
import {
  getDashboardStats,
  getFallingThroughCracks,
  getRecentMovement,
  getShepherdWorkload,
} from "@/lib/dashboard-read";
import { RefreshSnapshotsButton } from "./refresh-button";

export default async function HomePage() {
  const session = await requireOrg();
  const snapshot = getOrgSnapshot(session.orgId);
  return (
    <AppShell active="Home" breadcrumb="Home">
      <div className="px-5 md:px-7 py-7">
        <div className="flex items-baseline justify-between mb-6 gap-3 flex-wrap">
          <div>
            <div className="text-muted text-xs mb-1">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
            <p className="text-muted text-sm mt-1 max-w-xl">
              Who&apos;s drifting, who&apos;s ready for a step forward, and how
              the flock is moving this week.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RefreshSnapshotsButton
              isAdmin={session.role === "admin"}
              refreshedAt={snapshot?.refreshedAt ?? null}
            />
            <Link
              href="/care-queue"
              className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] font-medium text-xs"
            >
              Open care queue
            </Link>
          </div>
        </div>

        <Suspense fallback={<TopStatsSkeleton />}>
          <TopStats orgId={session.orgId} />
        </Suspense>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <Suspense fallback={<TableSkeleton title="Falling through the cracks" />}>
              <FallingThroughCracks orgId={session.orgId} />
            </Suspense>
          </Card>

          <Card>
            <SectionHeader title="People mix" rightLabel="by classification" />
            <Suspense fallback={<PieSkeleton />}>
              <PeopleMixPie orgId={session.orgId} />
            </Suspense>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
          <Card>
            <SectionHeader title="Movement · last 14 days" />
            <Suspense fallback={<ListSkeleton rows={4} />}>
              <Movement orgId={session.orgId} />
            </Suspense>
          </Card>

          <Card>
            <SectionHeader title="Shepherd workload" rightLabel="Top 5 by flock" />
            <Suspense fallback={<ListSkeleton rows={5} />}>
              <ShepherdWorkloadList orgId={session.orgId} />
            </Suspense>
          </Card>

          <Card>
            <SectionHeader title="Group health" rightLabel="Live status" />
            <Suspense fallback={<ListSkeleton rows={4} />}>
              <GroupHealth orgId={session.orgId} />
            </Suspense>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

// ─── People mix pie (shepherded / active / present) ──────────────

async function PeopleMixPie({ orgId }: { orgId: number }) {
  const settings = getSyncSettings(orgId);
  const counts = getClassificationCounts(orgId, settings.activityMonths);
  // Inactive is omitted — that bucket is people the system has
  // explicitly given up on, not a slice of the "currently engaged"
  // pie. Falling-through-the-cracks already surfaces them next to
  // this card.
  // Color semantics:
  //   Shepherded → green   (in a group/team — healthiest)
  //   Active     → amber   (engaging in some way, but not yet shepherded)
  //   Present    → grey    (on the books, no measurable engagement)
  const data = [
    {
      label: "Shepherded",
      count: counts.shepherded,
      color: "var(--good-soft-fg)",
    },
    {
      label: "Active",
      count: counts.active,
      color: "var(--warn-soft-fg)",
    },
    {
      label: "Present",
      count: counts.present,
      color: "var(--fg-subtle, #94a3b8)",
    },
  ];
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <InsufficientDataBlock
        line1="No people synced yet."
        line2="Run a sync on /pco to populate."
      />
    );
  }
  return (
    <div className="p-5">
      <PieChart data={data} preserveOrder />
      <p className="text-[11px] text-subtle mt-3 leading-snug">
        Excludes <span className="text-fg">{counts.inactive.toLocaleString()}</span>{" "}
        inactive (no measurable activity in {settings.activityMonths} mo) —
        those surface in &ldquo;Falling through the cracks&rdquo;.
      </p>
    </div>
  );
}

function PieSkeleton() {
  return (
    <div className="p-5 animate-pulse">
      <div className="mx-auto w-[180px] h-[180px] rounded-full bg-bg-elev-2/50" />
      <div className="space-y-2 mt-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-3 bg-bg-elev-2/50 rounded" />
        ))}
      </div>
    </div>
  );
}

// ─── Top stat strip ──────────────────────────────────────────────

async function TopStats({ orgId }: { orgId: number }) {
  const settings = getSyncSettings(orgId);
  const counts = getClassificationCounts(orgId, settings.activityMonths);
  const stats = getDashboardStats(orgId, settings.activityMonths);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      <Stat
        label="Active people"
        value={stats.active.toLocaleString()}
        delta={`activity in last ${settings.activityMonths} mo`}
      />
      <Stat
        label={`Joined · ${stats.monthLabel}`}
        value={
          stats.joinedMonth == null
            ? "—"
            : `+${stats.joinedMonth.toLocaleString()}`
        }
        valueTone="accent"
        delta={
          stats.joinedMonth == null
            ? "no membership data yet"
            : "new group + team memberships · 30d"
        }
      />
      <Stat
        label={`Departed · ${stats.monthLabel}`}
        value={
          stats.departedMonth == null
            ? "—"
            : `−${stats.departedMonth.toLocaleString()}`
        }
        delta={
          stats.departedMonth == null
            ? "no membership data yet"
            : "archived from group + team · 30d"
        }
      />
      <Stat
        label="Unshepherded"
        value={stats.unshepherded.toLocaleString()}
        delta={
          counts.total > 0
            ? `${Math.round((stats.unshepherded / counts.total) * 100)}% of all people`
            : "no people synced"
        }
      />
      <Stat
        label="Next-step ready"
        value="—"
        delta="insufficient data — classifier not wired"
      />
    </div>
  );
}

function TopStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="rounded-[10px] bg-bg-elev border border-border-soft p-4 animate-pulse"
        >
          <div className="h-2.5 w-20 bg-bg-elev-2 rounded mb-3" />
          <div className="h-6 w-16 bg-bg-elev-2/70 rounded" />
          <div className="h-2 w-24 bg-bg-elev-2/50 rounded mt-3" />
        </div>
      ))}
    </div>
  );
}

// ─── Falling through the cracks ──────────────────────────────────

async function FallingThroughCracks({ orgId }: { orgId: number }) {
  const settings = getSyncSettings(orgId);
  const list = getFallingThroughCracks(orgId, settings.activityMonths, 6);
  return (
    <>
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-border-soft">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Falling through the cracks</h2>
          <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted tnum">
            {list.length}
          </span>
        </div>
        <Link
          href="/people?tab=inactive"
          className="text-xs text-accent hover:underline"
        >
          See all inactive →
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted text-center">
          ✓ No one has gone silent past the {settings.activityMonths}-month
          threshold.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Person</th>
              <th className="text-left font-medium px-5 py-2 hidden md:table-cell">
                Last touch
              </th>
              <th className="text-right font-medium px-5 py-2">Silent</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const tone =
                p.daysSilent == null
                  ? "text-warn-soft-fg"
                  : p.daysSilent > 365
                    ? "text-warn-soft-fg"
                    : "text-muted";
              return (
                <tr
                  key={p.personId}
                  className="border-b border-border-softer hover:bg-bg-elev-2/60"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/people/${p.personId}`}
                      className="font-medium hover:text-accent"
                    >
                      {p.fullName}
                    </Link>
                    <div className="text-xs text-muted">{p.context}</div>
                  </td>
                  <td className="px-5 py-3 text-muted hidden md:table-cell">
                    {p.lastActivityAt
                      ? new Date(p.lastActivityAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className={`px-5 py-3 text-right tnum ${tone}`}>
                    {p.daysSilent == null
                      ? "ever"
                      : p.daysSilent > 365
                        ? `${Math.floor(p.daysSilent / 30)} mo`
                        : `${p.daysSilent}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

// ─── Movement ─────────────────────────────────────────────────────

async function Movement({ orgId }: { orgId: number }) {
  const events = getRecentMovement(orgId, 14, 8);
  if (events.length === 0) {
    return (
      <InsufficientDataBlock
        line1="No membership changes in the last 14 days."
        line2="(Or your PCO sync hasn't backfilled membership timestamps yet.)"
      />
    );
  }
  return (
    <ul>
      {events.map((m, i) => (
        <li
          key={`${m.personId}-${m.at}-${i}`}
          className="px-5 py-3 border-b border-border-softer last:border-0 flex items-start gap-3 text-sm"
        >
          <span className="text-xs text-muted w-10 shrink-0 mt-0.5">
            {m.day}
          </span>
          <Link
            href={`/people/${m.personId}`}
            className="text-fg hover:text-accent flex-1"
          >
            {m.text}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─── Shepherd workload ────────────────────────────────────────────

async function ShepherdWorkloadList({ orgId }: { orgId: number }) {
  const top = getShepherdWorkload(orgId, 5);
  if (top.length === 0) {
    return (
      <InsufficientDataBlock
        line1="No leaders detected yet."
        line2="Once group / team leaders are synced, top-flock-size shepherds show here."
      />
    );
  }
  const maxFlock = Math.max(1, ...top.map((s) => s.flockSize));
  return (
    <ul className="px-5 py-3 space-y-3 text-sm">
      {top.map((s) => {
        const pct = (s.flockSize / maxFlock) * 100;
        return (
          <li key={s.personId}>
            <div className="flex justify-between">
              <Link
                href={`/people/${s.personId}`}
                className="hover:text-accent"
              >
                {s.fullName}
              </Link>
              <span className="tnum text-muted">
                {s.flockSize} · {s.unitsLed} unit{s.unitsLed === 1 ? "" : "s"}
              </span>
            </div>
            <div className="h-1 bg-bg-elev-2 rounded mt-1.5 overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
      <li className="text-[11px] text-subtle pt-1 border-t border-border-softer">
        Shepherd capacity targets aren&apos;t tracked yet — bars are sized
        relative to the largest flock on this list.
      </li>
    </ul>
  );
}

// ─── Group health ─────────────────────────────────────────────────

async function GroupHealth({ orgId }: { orgId: number }) {
  const settings = getSyncSettings(orgId);
  const groups = listGroups(
    orgId,
    settings.activityMonths,
    settings.lapsedWeeks ?? 10,
  )
    .filter((g) => !g.archivedAt)
    .sort((a, b) => b.members - a.members)
    .slice(0, 5);
  if (groups.length === 0) {
    return (
      <InsufficientDataBlock
        line1="No active groups synced yet."
        line2="Run a PCO sync on the /pco page to populate."
      />
    );
  }
  return (
    <ul>
      {groups.map((g) => {
        const stateColor =
          g.state === "growing"
            ? "var(--good-soft-fg)"
            : g.state === "shrinking"
              ? "var(--warn-soft-fg)"
              : g.state === "paused"
                ? "var(--muted)"
                : "var(--fg)";
        return (
          <li
            key={g.pcoId}
            className="px-5 py-3 border-b border-border-softer last:border-0 text-sm"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate">{g.name ?? "(unnamed group)"}</span>
              <span className="text-xs tnum text-muted shrink-0">
                {g.members} members
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
              <span style={{ color: stateColor }}>● {g.state}</span>
              {g.joinedRecently > 0 && (
                <span>+{g.joinedRecently} joined</span>
              )}
              {g.leftRecently > 0 && (
                <span className="text-warn-soft-fg">
                  −{g.leftRecently} left
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Shared primitives ───────────────────────────────────────────

function SectionHeader({
  title,
  rightLabel,
  rightCount,
}: {
  title: string;
  rightLabel?: string;
  rightCount?: number | null;
}) {
  return (
    <div className="px-5 pt-4 pb-3 border-b border-border-soft flex items-center justify-between">
      <h2 className="text-sm font-semibold">{title}</h2>
      {rightCount != null ? (
        <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted tnum">
          {rightCount}
        </span>
      ) : rightLabel ? (
        <span className="text-xs text-muted">{rightLabel}</span>
      ) : null}
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
    <div className="px-5 py-7 text-center">
      <div className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-bg-elev-2 text-subtle mb-2">
        Insufficient data
      </div>
      <p className="text-sm text-muted">{line1}</p>
      {line2 && <p className="text-xs text-subtle mt-1">{line2}</p>}
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <ul className="px-5 py-3 space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="space-y-1.5 animate-pulse">
          <div className="h-3 bg-bg-elev-2/70 rounded w-3/4" />
          <div className="h-2 bg-bg-elev-2/50 rounded w-1/2" />
        </li>
      ))}
    </ul>
  );
}

function TableSkeleton({ title }: { title: string }) {
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
      <span className="sr-only">Loading {title}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  valueTone,
}: {
  label: string;
  value: string | number;
  delta: string;
  valueTone?: "accent" | "default";
}) {
  return (
    <div className="rounded-[10px] bg-bg-elev border border-border-soft p-4">
      <div className="text-xs text-muted mb-1.5">{label}</div>
      <div
        className={`tnum text-2xl font-semibold ${
          valueTone === "accent" ? "text-accent" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-muted mt-1">{delta}</div>
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[10px] bg-bg-elev border border-border-soft overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}
