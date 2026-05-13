import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  getCheckinEventStats,
  getExcludedGroupTypes,
  getExcludedMembershipTypes,
  getExcludedTeamTypes,
  getGroupTypeStats,
  getMembershipTypeStats,
  getServiceTypeStats,
  getShepherdedCheckinEvents,
} from "@/lib/pco";
import { CheckinEventsForm } from "./checkin-events-form";
import { FiltersForm } from "./form";
import { GroupTypeFiltersForm } from "./group-types-form";
import { TeamTypeFiltersForm } from "./team-types-form";

const TABS = [
  { key: "people", label: "Membership types" },
  { key: "groups", label: "Group types" },
  { key: "teams", label: "Team types" },
  { key: "checkins", label: "Check-in events" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function FiltersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const tab = (TABS.find((t) => t.key === params.tab)?.key ?? "people") as TabKey;

  const memStats = getMembershipTypeStats(session.orgId);
  const memExcluded = new Set(getExcludedMembershipTypes(session.orgId));
  const totalSynced = memStats.reduce((s, r) => s + r.count, 0);
  const memExcludedCount = memStats
    .filter((r) => r.membershipType && memExcluded.has(r.membershipType))
    .reduce((s, r) => s + r.count, 0);

  const groupStats = getGroupTypeStats(session.orgId);
  const groupExcluded = new Set(getExcludedGroupTypes(session.orgId));
  const groupExcludedMembers = groupStats
    .filter((r) => r.groupTypeId && groupExcluded.has(r.groupTypeId))
    .reduce((s, r) => s + r.members, 0);

  const teamStats = getServiceTypeStats(session.orgId);
  const teamExcluded = new Set(getExcludedTeamTypes(session.orgId));

  const checkinStats = getCheckinEventStats(session.orgId);
  const shepherdedCheckinSet = new Set(
    getShepherdedCheckinEvents(session.orgId),
  );

  return (
    <AppShell active="Filters" breadcrumb="Settings › Filters">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <div className="text-muted text-xs mb-1">Settings · filters</div>
          <h1 className="text-2xl font-semibold tracking-tight">Filters</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Exclude PCO categories you don&apos;t want counted in Shepherding. Excluded
            rows are still synced and stored — flip them back on any time.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">People synced</div>
            <div className="tnum text-2xl font-semibold">{totalSynced.toLocaleString()}</div>
            <div className="text-xs text-muted mt-1">all rows in DB</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">People excluded</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">
              {memExcludedCount.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">
              {memExcluded.size} membership type{memExcluded.size === 1 ? "" : "s"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Group types</div>
            <div className="tnum text-2xl font-semibold">{groupStats.length}</div>
            <div className="text-xs text-muted mt-1">distinct values</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Members in excluded types</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">
              {groupExcludedMembers.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">
              won&apos;t count for Shepherded
            </div>
          </Card>
        </div>

        {/* Tabs */}
        <div className="border-b border-border-soft">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map((t) => {
              const isActive = t.key === tab;
              const count =
                t.key === "people"
                  ? memStats.length
                  : t.key === "groups"
                    ? groupStats.length
                    : t.key === "teams"
                      ? teamStats.length
                      : checkinStats.length;
              return (
                <Link
                  key={t.key}
                  href={t.key === "people" ? "/pco/filters" : `/pco/filters?tab=${t.key}`}
                  className={`px-3 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap inline-flex items-baseline gap-1.5 ${
                    isActive
                      ? "border-accent text-fg font-medium"
                      : "border-transparent text-muted hover:text-fg hover:border-border-soft"
                  }`}
                >
                  <span>{t.label}</span>
                  <span
                    className={`tnum text-xs ${isActive ? "text-accent" : "text-subtle"}`}
                  >
                    {count.toLocaleString()}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        {tab === "checkins" ? (
          <Card>
            <CardHeader
              title="Check-in events"
              badge={
                session.role === "admin" ? null : <Pill tone="muted">read-only</Pill>
              }
              right={
                <span className="text-xs text-muted">
                  flagged events count check-ins as Shepherded (kids / students)
                </span>
              }
            />
            {checkinStats.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted">
                No check-in events yet — enable Check-ins under Sync settings and run a sync.
              </div>
            ) : (
              <CheckinEventsForm
                stats={checkinStats}
                initialShepherded={Array.from(shepherdedCheckinSet)}
                isAdmin={session.role === "admin"}
              />
            )}
          </Card>
        ) : tab === "teams" ? (
          <Card>
            <CardHeader
              title="Service team types"
              badge={
                session.role === "admin" ? null : <Pill tone="muted">read-only</Pill>
              }
              right={
                <span className="text-xs text-muted">
                  excluded service types don&apos;t count for the Serve lane
                </span>
              }
            />
            {teamStats.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted">
                No service types yet — enable Teams under Sync settings and run a sync.
              </div>
            ) : (
              <TeamTypeFiltersForm
                stats={teamStats}
                initialExcluded={Array.from(teamExcluded)}
                isAdmin={session.role === "admin"}
              />
            )}
          </Card>
        ) : tab === "people" ? (
          <Card>
            <CardHeader
              title="Membership types"
              badge={
                session.role === "admin" ? null : <Pill tone="muted">read-only</Pill>
              }
              right={
                <span className="text-xs text-muted">
                  hides excluded rows from People, Metrics, Care queue
                </span>
              }
            />
            {memStats.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted">
                No membership types yet — run a sync first.
              </div>
            ) : (
              <FiltersForm
                stats={memStats}
                initialExcluded={Array.from(memExcluded)}
                isAdmin={session.role === "admin"}
              />
            )}
          </Card>
        ) : (
          <Card>
            <CardHeader
              title="Group types"
              badge={
                session.role === "admin" ? null : <Pill tone="muted">read-only</Pill>
              }
              right={
                <span className="text-xs text-muted">
                  excluded types don&apos;t count for Shepherded
                </span>
              }
            />
            {groupStats.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted">
                No group types yet — enable Groups under Sync settings and run a sync.
              </div>
            ) : (
              <GroupTypeFiltersForm
                stats={groupStats}
                initialExcluded={Array.from(groupExcluded)}
                isAdmin={session.role === "admin"}
              />
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
