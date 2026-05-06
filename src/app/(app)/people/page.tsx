import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import {
  type ActivityClassification,
  getClassificationCounts,
  listPeople,
  type SyncedPersonRow,
} from "@/lib/people-read";

const PAGE_SIZE = 100;

const TABS: { key: "all" | ActivityClassification; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "present", label: "Present" },
  { key: "inactive", label: "Inactive" },
];

interface SearchParams {
  tab?: string;
  page?: string;
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const params = await searchParams;
  const tab = (TABS.find((t) => t.key === params.tab)?.key ?? "all") as
    | "all"
    | ActivityClassification;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const counts = getClassificationCounts(session.orgId, settings.activityMonths);
  const result = listPeople({
    orgId: session.orgId,
    activityMonths: settings.activityMonths,
    tab,
    limit: PAGE_SIZE,
    offset,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <AppShell active="People" breadcrumb={`People · ${TABS.find((t) => t.key === tab)!.label}`}>
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">People</h1>
            <p className="text-muted text-sm mt-1">
              {counts.total === 0
                ? "No synced people yet — connect PCO and run a sync."
                : `${counts.total.toLocaleString()} people synced from PCO. Activity threshold: ${settings.activityMonths} months (set in Metrics).`}
            </p>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Total in system</div>
            <div className="tnum text-2xl font-semibold">{counts.total.toLocaleString()}</div>
            <div className="text-xs text-muted mt-1">all people synced</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Active</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">{counts.active}</div>
            <div className="text-xs text-muted mt-1">forms / groups / teams (later)</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Present</div>
            <div className="tnum text-2xl font-semibold text-accent">{counts.present.toLocaleString()}</div>
            <div className="text-xs text-muted mt-1">
              touched in last {settings.activityMonths}mo
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Inactive</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">{counts.inactive.toLocaleString()}</div>
            <div className="text-xs text-muted mt-1">no updates {settings.activityMonths}mo+</div>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border-soft -mb-3 overflow-x-auto">
          {TABS.map((t) => {
            const isActive = t.key === tab;
            const count =
              t.key === "all"
                ? counts.total
                : t.key === "active"
                  ? counts.active
                  : t.key === "present"
                    ? counts.present
                    : counts.inactive;
            return (
              <Link
                key={t.key}
                href={t.key === "all" ? "/people" : `/people?tab=${t.key}`}
                className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-accent text-fg font-medium"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {t.label}{" "}
                <span className={`tnum text-xs ${isActive ? "text-accent" : "text-subtle"}`}>
                  {count.toLocaleString()}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Table */}
        {counts.total === 0 ? (
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
        ) : tab === "active" ? (
          <Card className="p-10 text-center">
            <h3 className="font-semibold mb-2">Coming with richer signals</h3>
            <p className="text-sm text-muted max-w-md mx-auto">
              The Active classification depends on form submissions, group memberships, team
              participation, and check-in attendance. Once those are synced, this tab will
              populate.
            </p>
          </Card>
        ) : tab === "inactive" ? (
          <InactiveTable people={result.rows} thresholdMonths={settings.activityMonths} />
        ) : (
          <PeopleTable people={result.rows} total={result.total} />
        )}

        {/* Pagination — hide for tabs that don't paginate */}
        {(tab === "all" || tab === "present" || tab === "inactive") && counts.total > 0 && (
          <Pagination tab={tab} page={page} totalPages={totalPages} total={result.total} />
        )}
      </div>
    </AppShell>
  );
}

function PeopleTable({ people, total }: { people: SyncedPersonRow[]; total: number }) {
  return (
    <Card>
      <CardHeader title="People" right={<span className="text-xs text-muted">{people.length} of {total.toLocaleString()}</span>} />
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border-soft">
            <th className="text-left font-medium px-5 py-2">Name</th>
            <th className="text-left font-medium px-5 py-2 hidden md:table-cell">Status</th>
            <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Membership</th>
            <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">PCO updated</th>
            <th className="text-right font-medium px-5 py-2 hidden xl:table-cell">PCO created</th>
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
                <Pill tone={p.classification === "present" ? "accent" : "warn"}>
                  {p.classification}
                </Pill>
              </td>
              <td className="px-5 py-2.5 hidden lg:table-cell text-muted">
                {p.membershipType ?? <span className="text-subtle">—</span>}
              </td>
              <td className="px-5 py-2.5 hidden lg:table-cell text-muted">
                {p.pcoUpdatedAt ? new Date(p.pcoUpdatedAt).toLocaleDateString() : "—"}
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

function InactiveTable({
  people,
  thresholdMonths,
}: {
  people: SyncedPersonRow[];
  thresholdMonths: number;
}) {
  return (
    <Card>
      <CardHeader
        title="Inactive — slipped away"
        right={
          <span className="text-xs text-muted">
            no PCO updates in {thresholdMonths}mo+
          </span>
        }
      />
      {people.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted">
          No one is currently inactive on this page.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Name</th>
              <th className="text-left font-medium px-5 py-2">Last update</th>
              <th className="text-left font-medium px-5 py-2 hidden md:table-cell">Membership</th>
              <th className="text-right font-medium px-5 py-2 hidden xl:table-cell">First created</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.pcoId} className="border-b border-border-softer hover:bg-bg-elev-2/60">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar initials={p.initials} size="sm" />
                    <div>
                      <div className="font-medium">{p.fullName}</div>
                      <div className="text-xs text-muted">PCO #{p.pcoId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-muted">
                  {p.pcoUpdatedAt ? (
                    <>
                      <div className="text-fg">{relativeTime(p.pcoUpdatedAt)}</div>
                      <div className="text-xs">
                        {new Date(p.pcoUpdatedAt).toLocaleDateString()}
                      </div>
                    </>
                  ) : (
                    "never"
                  )}
                </td>
                <td className="px-5 py-3 hidden md:table-cell text-muted">
                  {p.membershipType ?? <span className="text-subtle">—</span>}
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

function Pagination({
  tab,
  page,
  totalPages,
  total,
}: {
  tab: string;
  page: number;
  totalPages: number;
  total: number;
}) {
  const base = tab === "all" ? "/people" : `/people?tab=${tab}`;
  const sep = tab === "all" ? "?" : "&";
  const prevHref = page <= 1 ? null : `${base}${sep}page=${page - 1}`;
  const nextHref = page >= totalPages ? null : `${base}${sep}page=${page + 1}`;
  const showFrom = (page - 1) * PAGE_SIZE + 1;
  const showTo = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between text-sm pt-2">
      <div className="text-muted">
        Showing <span className="text-fg tnum">{showFrom.toLocaleString()}</span>–
        <span className="text-fg tnum">{showTo.toLocaleString()}</span> of{" "}
        <span className="text-fg tnum">{total.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2">
        {prevHref ? (
          <Link
            href={prevHref}
            className="px-3 py-1.5 rounded border border-border-soft text-fg hover:bg-bg-elev-2/60"
          >
            ← Prev
          </Link>
        ) : (
          <span className="px-3 py-1.5 rounded border border-border-soft text-subtle cursor-not-allowed">
            ← Prev
          </span>
        )}
        <span className="text-muted text-xs tnum">
          Page {page} of {totalPages.toLocaleString()}
        </span>
        {nextHref ? (
          <Link
            href={nextHref}
            className="px-3 py-1.5 rounded border border-border-soft text-fg hover:bg-bg-elev-2/60"
          >
            Next →
          </Link>
        ) : (
          <span className="px-3 py-1.5 rounded border border-border-soft text-subtle cursor-not-allowed">
            Next →
          </span>
        )}
      </div>
    </div>
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
