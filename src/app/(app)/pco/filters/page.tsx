import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getExcludedMembershipTypes, getMembershipTypeStats } from "@/lib/pco";
import { FiltersForm } from "./form";

export default async function FiltersPage() {
  const session = await requireOrg();
  const stats = getMembershipTypeStats(session.orgId);
  const excluded = new Set(getExcludedMembershipTypes(session.orgId));
  const totalSynced = stats.reduce((s, r) => s + r.count, 0);
  const excludedCount = stats
    .filter((r) => r.membershipType && excluded.has(r.membershipType))
    .reduce((s, r) => s + r.count, 0);

  return (
    <AppShell active="Filters" breadcrumb="PCO › Filters">
      <div className="px-5 md:px-7 py-7 max-w-5xl space-y-6">
        <div>
          <div className="text-muted text-xs mb-1">PCO · filters</div>
          <h1 className="text-2xl font-semibold tracking-tight">People filters</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Exclude PCO membership types you don&apos;t want counted as people in
            Shepherding — staff, kids, archived contacts, etc. Excluded rows are still synced
            and stored, but hidden from People, Metrics counts, and the Care queue.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">People synced</div>
            <div className="tnum text-2xl font-semibold">{totalSynced.toLocaleString()}</div>
            <div className="text-xs text-muted mt-1">all rows in DB</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Excluded</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">
              {excludedCount.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">
              {excluded.size} membership type{excluded.size === 1 ? "" : "s"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Visible</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">
              {(totalSynced - excludedCount).toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">shown in People</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Membership types</div>
            <div className="tnum text-2xl font-semibold">{stats.length}</div>
            <div className="text-xs text-muted mt-1">distinct values</div>
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
          {stats.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted">
              No membership types yet — run a sync first.
            </div>
          ) : (
            <FiltersForm
              stats={stats}
              initialExcluded={Array.from(excluded)}
              isAdmin={session.role === "admin"}
            />
          )}
        </Card>

        <p className="text-xs text-muted">
          Filters affect display only — your synced data stays intact in the encrypted store.
          Toggle them off any time to bring people back.
        </p>
      </div>
    </AppShell>
  );
}
