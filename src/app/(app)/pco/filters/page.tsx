import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  getExcludedGroupTypes,
  getExcludedMembershipTypes,
  getGroupTypeStats,
  getMembershipTypeStats,
} from "@/lib/pco";
import { FiltersForm } from "./form";
import { GroupTypeFiltersForm } from "./group-types-form";

export default async function FiltersPage() {
  const session = await requireOrg();
  const memStats = getMembershipTypeStats(session.orgId);
  const memExcluded = new Set(getExcludedMembershipTypes(session.orgId));
  const totalSynced = memStats.reduce((s, r) => s + r.count, 0);
  const memExcludedCount = memStats
    .filter((r) => r.membershipType && memExcluded.has(r.membershipType))
    .reduce((s, r) => s + r.count, 0);

  const groupStats = getGroupTypeStats(session.orgId);
  const groupExcluded = new Set(getExcludedGroupTypes(session.orgId));

  return (
    <AppShell active="Filters" breadcrumb="Settings › Filters">
      <div className="px-5 md:px-7 py-7 max-w-5xl space-y-6">
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
            <div className="text-xs text-muted mb-1.5">Group types excluded</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">
              {groupExcluded.size}
            </div>
            <div className="text-xs text-muted mt-1">won&apos;t count for Shepherded</div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Membership types"
            badge={
              session.role === "admin" ? null : <Pill tone="muted">read-only</Pill>
            }
            right={
              <span className="text-xs text-muted">click to toggle exclusion</span>
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

        <Card>
          <CardHeader
            title="Group types"
            badge={
              session.role === "admin" ? null : <Pill tone="muted">read-only</Pill>
            }
            right={
              <span className="text-xs text-muted">
                exclude types from Shepherded count
              </span>
            }
          />
          {groupStats.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted">
              No group types yet — enable the Groups sync entity and run a sync.
            </div>
          ) : (
            <GroupTypeFiltersForm
              stats={groupStats}
              initialExcluded={Array.from(groupExcluded)}
              isAdmin={session.role === "admin"}
            />
          )}
        </Card>

        <p className="text-xs text-muted">
          Membership filters hide people from People, Metrics counts, and the Care queue.
          Group-type filters affect the Shepherded classification — anyone whose only
          memberships are in excluded types will fall back to Active / Present / Inactive.
        </p>
      </div>
    </AppShell>
  );
}
