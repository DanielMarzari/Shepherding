import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import { listPeople, type ActivityClassification, type SyncedPersonRow } from "@/lib/people-read";

const TABS: { key: "all" | ActivityClassification; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "present", label: "Present" },
  { key: "inactive", label: "Inactive" },
];

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const all = listPeople(session.orgId, settings.activityMonths);
  const params = await searchParams;
  const tab = (TABS.find((t) => t.key === params.tab)?.key ?? "all") as
    | "all"
    | ActivityClassification;

  const filtered = tab === "all" ? all : all.filter((p) => p.classification === tab);

  const counts = {
    all: all.length,
    active: all.filter((p) => p.classification === "active").length,
    present: all.filter((p) => p.classification === "present").length,
    inactive: all.filter((p) => p.classification === "inactive").length,
  };

  return (
    <AppShell active="People" breadcrumb={`People · ${TABS.find((t) => t.key === tab)!.label}`}>
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">People</h1>
            <p className="text-muted text-sm mt-1">
              {all.length === 0
                ? "No synced people yet — connect PCO and run a sync."
                : `${all.length} people synced from PCO. Activity threshold: ${settings.activityMonths} months (set in Metrics).`}
            </p>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Total in system</div>
            <div className="tnum text-2xl font-semibold">{counts.all}</div>
            <div className="text-xs text-muted mt-1">all people synced</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Active</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">{counts.active}</div>
            <div className="text-xs text-muted mt-1">activity in last {settings.activityMonths}mo</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Present</div>
            <div className="tnum text-2xl font-semibold text-accent">{counts.present}</div>
            <div className="text-xs text-muted mt-1">new but not yet active</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Inactive</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">{counts.inactive}</div>
            <div className="text-xs text-muted mt-1">no activity {settings.activityMonths}mo+</div>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border-soft -mb-3">
          {TABS.map((t) => {
            const isActive = t.key === tab;
            const count = counts[t.key];
            return (
              <Link
                key={t.key}
                href={t.key === "all" ? "/people" : `/people?tab=${t.key}`}
                className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  isActive
                    ? "border-accent text-fg font-medium"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {t.label}{" "}
                <span className={`tnum text-xs ${isActive ? "text-accent" : "text-subtle"}`}>
                  {count}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Table */}
        {all.length === 0 ? (
          <Card className="p-10 text-center">
            <h3 className="font-semibold mb-2">No data yet</h3>
            <p className="text-sm text-muted max-w-md mx-auto">
              Once you save PCO credentials and click <strong>Sync now</strong> on the{" "}
              <Link href="/pco" className="text-accent hover:underline">
                Sync settings page
              </Link>
              , every person from your PCO database will appear here — encrypted at rest.
            </p>
          </Card>
        ) : tab === "inactive" ? (
          <InactivePeopleTable people={filtered} thresholdMonths={settings.activityMonths} />
        ) : (
          <PeopleTable people={filtered} />
        )}
      </div>
    </AppShell>
  );
}

function PeopleTable({ people }: { people: SyncedPersonRow[] }) {
  return (
    <Card>
      <CardHeader title="People" right={<span className="text-xs text-muted">{people.length} shown</span>} />
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border-soft">
            <th className="text-left font-medium px-5 py-2">Name</th>
            <th className="text-left font-medium px-5 py-2 hidden md:table-cell">Status</th>
            <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Membership</th>
            <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Last activity</th>
            <th className="text-right font-medium px-5 py-2 hidden xl:table-cell">Joined PCO</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.pcoId} className="border-b border-border-softer hover:bg-bg-elev-2/60">
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-3">
                  <Avatar initials={p.initials} size="sm" />
                  <div>
                    <div className="font-medium">{p.fullName}</div>
                    <div className="text-xs text-muted">PCO #{p.pcoId}</div>
                  </div>
                </div>
              </td>
              <td className="px-5 py-2.5 hidden md:table-cell">
                <Pill
                  tone={
                    p.classification === "active"
                      ? "good"
                      : p.classification === "present"
                        ? "accent"
                        : "warn"
                  }
                >
                  {p.classification}
                </Pill>
              </td>
              <td className="px-5 py-2.5 hidden lg:table-cell text-muted">
                {p.membershipType ?? <span className="text-subtle">—</span>}
              </td>
              <td className="px-5 py-2.5 hidden lg:table-cell text-muted">
                {p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleDateString() : "—"}
              </td>
              <td className="px-5 py-2.5 text-right hidden xl:table-cell tnum text-muted">
                {p.pcoCreatedAt ? new Date(p.pcoCreatedAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function InactivePeopleTable({
  people,
  thresholdMonths,
}: {
  people: SyncedPersonRow[];
  thresholdMonths: number;
}) {
  // Sort by last activity (most recently inactive first — most likely to come back).
  const sorted = [...people].sort((a, b) => {
    const ax = a.lastActivityAt ?? a.pcoUpdatedAt ?? "";
    const bx = b.lastActivityAt ?? b.pcoUpdatedAt ?? "";
    return bx.localeCompare(ax);
  });
  return (
    <Card>
      <CardHeader
        title="Inactive — slipped away"
        right={
          <span className="text-xs text-muted">
            no activity {thresholdMonths}mo+ · created &gt; {thresholdMonths}mo ago
          </span>
        }
      />
      {sorted.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted">
          No one is currently classified inactive. 🎉
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Name</th>
              <th className="text-left font-medium px-5 py-2">Last seen</th>
              <th className="text-left font-medium px-5 py-2 hidden md:table-cell">Last activity (PCO updated)</th>
              <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">PCO marked inactive</th>
              <th className="text-right font-medium px-5 py-2 hidden xl:table-cell">First joined</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.pcoId} className="border-b border-border-softer hover:bg-bg-elev-2/60">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar initials={p.initials} size="sm" />
                    <div>
                      <div className="font-medium">{p.fullName}</div>
                      <div className="text-xs text-muted">
                        {p.membershipType ?? "—"}
                        {p.pcoInactive && (
                          <>
                            {" · "}
                            <span className="text-warn-soft-fg">PCO inactive</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-muted">
                  {p.lastActivityAt ? (
                    <>
                      <div className="text-fg">{relativeTime(p.lastActivityAt)}</div>
                      <div className="text-xs">
                        {new Date(p.lastActivityAt).toLocaleDateString()}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-3 hidden md:table-cell text-muted">
                  {p.pcoUpdatedAt ? new Date(p.pcoUpdatedAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-5 py-3 hidden lg:table-cell text-muted">
                  {p.inactivatedAt ? new Date(p.inactivatedAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-5 py-3 text-right hidden xl:table-cell tnum text-muted">
                  {p.pcoCreatedAt ? new Date(p.pcoCreatedAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const months = (Date.now() - d.valueOf()) / (1000 * 60 * 60 * 24 * 30);
  if (months < 1) return "less than a month ago";
  if (months < 12) return `${Math.floor(months)} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
