import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import {
  type ActivityClassification,
  getClassificationCounts,
  listPeople,
  type SortColumn,
  type SortDir,
  type SyncedPersonRow,
} from "@/lib/people-read";

const PAGE_SIZE = 100;

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

  const counts = getClassificationCounts(session.orgId, settings.activityMonths);
  const result = listPeople({
    orgId: session.orgId,
    activityMonths: settings.activityMonths,
    tab: tab as Parameters<typeof listPeople>[0]["tab"],
    limit: PAGE_SIZE,
    offset,
    sort,
    dir,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  function buildLink(overrides: Partial<SearchParams>): string {
    const merged: SearchParams = { tab, page: String(page), sort, dir, ...overrides };
    const search = new URLSearchParams();
    if (merged.tab && merged.tab !== "all") search.set("tab", merged.tab);
    if (merged.page && merged.page !== "1") search.set("page", merged.page);
    if (merged.sort && merged.sort !== "updated") search.set("sort", merged.sort);
    if (merged.dir && merged.dir !== "desc") search.set("dir", merged.dir);
    const qs = search.toString();
    return qs ? `/people?${qs}` : "/people";
  }

  function sortLink(column: SortColumn): string {
    const newDir: SortDir =
      sort === column ? (dir === "desc" ? "asc" : "desc") : "desc";
    return buildLink({ sort: column, dir: newDir, page: "1" });
  }

  return (
    <AppShell active="People" breadcrumb={`People · ${TABS.find((t) => t.key === tab)!.label}`}>
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">People</h1>
            <p className="text-muted text-sm mt-1">
              {counts.total === 0
                ? "No synced people yet — connect PCO and run a sync."
                : `${counts.visibleByDefault.toLocaleString()} visible · ${counts.inactive.toLocaleString()} inactive (hidden) · activity threshold ${settings.activityMonths}mo (set in Metrics)`}
            </p>
          </div>
        </div>

        {/* Stat strip: Shepherded · Active · Present · Inactive */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Shepherded</div>
            <div className="tnum text-2xl font-semibold">{counts.shepherded}</div>
            <div className="text-xs text-muted mt-1">in a group or team</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Active</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">
              {counts.active.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">forms · registrations · etc.</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Present</div>
            <div className="tnum text-2xl font-semibold text-accent">
              {counts.present.toLocaleString()}
            </div>
            <div className="text-xs text-muted mt-1">
              touched in last {settings.activityMonths}mo
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Inactive</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">
              {counts.inactive.toLocaleString()}
            </div>
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
        ) : tab === "shepherded" ? (
          <Card className="p-10 text-center">
            <h3 className="font-semibold mb-2">Coming with group/team sync</h3>
            <p className="text-sm text-muted max-w-md mx-auto">
              Shepherded counts everyone in a group or team. Once group + team membership is
              synced from PCO, this tab populates.
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

        {tab !== "shepherded" && counts.total > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={result.total}
            buildLink={buildLink}
          />
        )}
      </div>
    </AppShell>
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
        <table className="w-full text-sm table-fixed min-w-[760px]">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[14%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Name</th>
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
