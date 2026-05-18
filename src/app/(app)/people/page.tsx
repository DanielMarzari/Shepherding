import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, Pill } from "@/components/ui";
import { Suspense } from "react";
import { AsyncDemographicCharts } from "@/components/AsyncChartSections";
import { DemographicChartsSkeleton } from "@/components/ChartsLoading";
import { requireOrg } from "@/lib/auth";
import { getMembershipTypeStats, getSyncSettings } from "@/lib/pco";
import {
  type ActivityClassification,
  getClassificationCounts,
  listPeople,
  type SortColumn,
  type SortDir,
  type SyncedPersonRow,
} from "@/lib/people-read";
import { MembershipFilter } from "./membership-filter";
import { PageJump } from "./page-jump";

const PAGE_SIZE = 50;

type TabKey = "all" | "shepherded" | "active" | "present" | "inactive";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "shepherded", label: "Shepherded" },
  { key: "active", label: "Active" },
  { key: "present", label: "Present" },
  { key: "inactive", label: "Inactive" },
];

const VALID_SORTS: SortColumn[] = ["updated", "created", "membership", "status"];

interface SearchParams {
  tab?: string;
  page?: string;
  sort?: string;
  dir?: string;
  membership?: string;
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const params = await searchParams;
  const tab = (TABS.find((t) => t.key === params.tab)?.key ?? "all") as TabKey;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const sort: SortColumn = VALID_SORTS.includes(params.sort as SortColumn)
    ? (params.sort as SortColumn)
    : "updated";
  const dir: SortDir = params.dir === "asc" ? "asc" : "desc";
  const membership = (params.membership ?? "").trim() || undefined;

  const counts = getClassificationCounts(session.orgId, settings.activityMonths);
  const memTypeStats = getMembershipTypeStats(session.orgId);
  const result = listPeople({
    orgId: session.orgId,
    activityMonths: settings.activityMonths,
    tab: tab as Parameters<typeof listPeople>[0]["tab"],
    limit: PAGE_SIZE,
    offset,
    sort,
    dir,
    membershipType: membership,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  function buildLink(overrides: Partial<SearchParams>): string {
    const merged: SearchParams = {
      tab,
      page: String(page),
      sort,
      dir,
      membership,
      ...overrides,
    };
    const search = new URLSearchParams();
    if (merged.tab && merged.tab !== "all") search.set("tab", merged.tab);
    if (merged.page && merged.page !== "1") search.set("page", merged.page);
    if (merged.sort && merged.sort !== "updated") search.set("sort", merged.sort);
    if (merged.dir && merged.dir !== "desc") search.set("dir", merged.dir);
    if (merged.membership) search.set("membership", merged.membership);
    const qs = search.toString();
    return qs ? `/people?${qs}` : "/people";
  }

  function sortLink(column: SortColumn): string {
    const newDir: SortDir =
      sort === column ? (dir === "desc" ? "asc" : "desc") : "desc";
    return buildLink({ sort: column, dir: newDir, page: "1" });
  }

  return (
    <AppShell active="People" breadcrumb={`People › ${TABS.find((t) => t.key === tab)!.label}`}>
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">People</h1>
            <p className="text-muted text-sm mt-1">
              {counts.total === 0
                ? "No synced people yet — connect PCO and run a sync."
                : `${counts.visibleByDefault.toLocaleString()} visible · ${counts.inactive.toLocaleString()} inactive (hidden) · activity threshold ${settings.activityMonths}mo (set in Metrics)`}
            </p>
          </div>
          {counts.total > 0 && (
            <MembershipFilter
              current={membership ?? ""}
              options={memTypeStats.map((s) => ({
                value: s.membershipType ?? "__none__",
                label: s.membershipType ?? "(no membership)",
                count: s.count,
              }))}
            />
          )}
        </div>

        {/* Stat strip: Shepherded · Active · Present · Inactive */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Shepherded</div>
            <AdultKidNumber
              adults={counts.shepherded - counts.shepherdedKids}
              kids={counts.shepherdedKids}
            />
            <div className="text-xs text-muted mt-1">
              group, team, or Sunday program
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Active</div>
            <AdultKidNumber
              adults={counts.active - counts.activeKids}
              kids={counts.activeKids}
              tone="good"
            />
            <div className="text-xs text-muted mt-1">forms · check-ins · etc.</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Present</div>
            <AdultKidNumber
              adults={counts.present - counts.presentKids}
              kids={counts.presentKids}
              tone="accent"
            />
            <div className="text-xs text-muted mt-1">
              record edited in {settings.activityMonths}mo
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Inactive</div>
            <AdultKidNumber
              adults={counts.inactive - counts.inactiveKids}
              kids={counts.inactiveKids}
              tone="warn"
            />
            <div className="text-xs text-muted mt-1">hidden from All — historical</div>
          </Card>
        </div>

        {/* Tabs */}
        <div className="border-b border-border-soft">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map((t) => {
              const isActive = t.key === tab;
              const count =
                t.key === "all"
                  ? counts.visibleByDefault
                  : t.key === "shepherded"
                    ? counts.shepherded
                    : t.key === "active"
                      ? counts.active
                      : t.key === "present"
                        ? counts.present
                        : counts.inactive;
              return (
                <Link
                  key={t.key}
                  href={buildLink({ tab: t.key, page: "1" })}
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
        ) : (
          <PeopleTable
            people={result.rows}
            total={result.total}
            sort={sort}
            dir={dir}
            sortLink={sortLink}
          />
        )}

        {counts.total > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={result.total}
            buildLink={buildLink}
          />
        )}

        {counts.total > 0 && (
          <Suspense
            fallback={
              <DemographicChartsSkeleton title="Demographics — all people" />
            }
          >
            <AsyncDemographicCharts
              orgId={session.orgId}
              scope={{ kind: "all" }}
              title="Demographics — all people"
            />
          </Suspense>
        )}
      </div>
    </AppShell>
  );
}

/** Stat-card body that shows ADULT count as the headline and the kids
 *  count as a small "(+N kids)" hint underneath. The user almost never
 *  cares about kids for next-step / outreach lists, so the adult number
 *  is the one that pops; the kids count stays visible for context. */
function AdultKidNumber({
  adults,
  kids,
  tone,
}: {
  adults: number;
  kids: number;
  tone?: "good" | "accent" | "warn";
}) {
  const toneCls =
    tone === "good"
      ? "text-good-soft-fg"
      : tone === "accent"
        ? "text-accent"
        : tone === "warn"
          ? "text-warn-soft-fg"
          : "";
  return (
    <div className="flex items-baseline gap-2">
      <div className={`tnum text-2xl font-semibold ${toneCls}`}>
        {adults.toLocaleString()}
      </div>
      {kids > 0 && (
        <div className="tnum text-xs text-muted">
          +{kids.toLocaleString()} kids
        </div>
      )}
    </div>
  );
}

/** Adult / Kid pill for the People table. We deliberately don't show
 *  the actual age on a dashboard you might share — kids almost always
 *  have a birthdate in PCO so "Adult" is the safe default when one is
 *  missing. */
function AgeBadge({ isMinor }: { isMinor: boolean }) {
  if (isMinor) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-warn-soft-bg text-warn-soft-fg">
        Kid
      </span>
    );
  }
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted">
      Adult
    </span>
  );
}

function PeopleTable({
  people,
  total,
  sort,
  dir,
  sortLink,
}: {
  people: SyncedPersonRow[];
  total: number;
  sort: SortColumn;
  dir: SortDir;
  sortLink: (c: SortColumn) => string;
}) {
  return (
    <Card>
      <CardHeader
        title="People"
        right={
          <span className="text-xs text-muted">
            {people.length} of {total.toLocaleString()}
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed min-w-[860px]">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Name</th>
              <th className="text-left font-medium px-5 py-2">Age</th>
              <SortableTh
                label="Status"
                column="status"
                currentSort={sort}
                currentDir={dir}
                link={sortLink("status")}
              />
              <SortableTh
                label="Membership"
                column="membership"
                currentSort={sort}
                currentDir={dir}
                link={sortLink("membership")}
              />
              <SortableTh
                label="Updated"
                column="updated"
                currentSort={sort}
                currentDir={dir}
                link={sortLink("updated")}
              />
              <SortableTh
                label="Created"
                column="created"
                currentSort={sort}
                currentDir={dir}
                link={sortLink("created")}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <PersonRow key={p.pcoId} p={p} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PersonRow({ p }: { p: SyncedPersonRow }) {
  return (
    <tr className="border-b border-border-softer hover:bg-bg-elev-2/60">
      <td className="px-5 py-2.5">
        <Link
          href={`/people/${p.pcoId}`}
          className="flex items-center gap-3 group"
        >
          <Avatar initials={p.initials} size="sm" />
          <div className="min-w-0">
            <div className="font-medium truncate group-hover:text-accent">
              {p.fullName}
            </div>
            <div className="text-xs text-muted">PCO #{p.pcoId}</div>
          </div>
        </Link>
      </td>
      <td className="px-5 py-2.5">
        <AgeBadge isMinor={p.isMinor} />
      </td>
      <td className="px-5 py-2.5">
        <Pill tone={pillTone(p.classification)}>{p.classification}</Pill>
      </td>
      <td className="px-5 py-2.5 text-muted truncate">
        {p.membershipType ?? <span className="text-subtle">—</span>}
      </td>
      <td className="px-5 py-2.5 text-muted">
        {p.pcoUpdatedAt ? new Date(p.pcoUpdatedAt).toLocaleDateString() : "—"}
      </td>
      <td className="px-5 py-2.5 text-right tnum text-muted">
        {p.pcoCreatedAt ? new Date(p.pcoCreatedAt).toLocaleDateString() : "—"}
      </td>
    </tr>
  );
}

function pillTone(c: ActivityClassification): "good" | "accent" | "warn" | "muted" {
  if (c === "active") return "good";
  if (c === "shepherded") return "accent";
  if (c === "present") return "accent";
  return "warn";
}

function SortableTh({
  label,
  column,
  currentSort,
  currentDir,
  link,
  align = "left",
}: {
  label: string;
  column: SortColumn;
  currentSort: SortColumn;
  currentDir: SortDir;
  link: string;
  align?: "left" | "right";
}) {
  const isActive = currentSort === column;
  const arrow = isActive ? (currentDir === "asc" ? "▲" : "▼") : "↕";
  return (
    <th className="font-medium px-5 py-2" style={{ textAlign: align }}>
      <Link
        href={link}
        className={`inline-flex items-center gap-1 hover:text-fg ${isActive ? "text-fg" : ""}`}
      >
        {label}
        <span className="text-[10px] tnum">{arrow}</span>
      </Link>
    </th>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  buildLink,
}: {
  page: number;
  totalPages: number;
  total: number;
  buildLink: (o: Partial<SearchParams>) => string;
}) {
  const prevHref = page <= 1 ? null : buildLink({ page: String(page - 1) });
  const nextHref = page >= totalPages ? null : buildLink({ page: String(page + 1) });
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
        <span className="text-muted text-xs tnum inline-flex items-center gap-1">
          Page <PageJump currentPage={page} totalPages={totalPages} />
          <span>of {totalPages.toLocaleString()}</span>
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
