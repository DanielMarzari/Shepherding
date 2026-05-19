import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  type DuplicateGroup,
  type DuplicateRow,
  findDuplicatesAcrossOrg,
} from "@/lib/audit-read";
import { DownloadCsvButton } from "../download-csv";

interface SearchParams {
  confidence?: string;
}

export default async function DuplicateAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const allGroups = findDuplicatesAcrossOrg(session.orgId);

  const highCount = allGroups.filter((g) => g.confidence === "high").length;
  const lowCount = allGroups.filter((g) => g.confidence === "low").length;

  const conf = params.confidence === "high" || params.confidence === "low"
    ? params.confidence
    : null;
  const groups = conf
    ? allGroups.filter((g) => g.confidence === conf)
    : allGroups;
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);

  const csvRows = groups.flatMap((g) =>
    g.rows.map((r) => ({ pcoId: r.pcoId, fullName: r.fullName })),
  );

  return (
    <AppShell active="Duplicate audit" breadcrumb="Duplicate audit">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Duplicate audit
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Cross-org scan for people who appear more than once under the same
            first + last name. Generational suffixes (Jr, Sr, II/III/IV) are
            stripped before matching, so &ldquo;Bob Smith&rdquo; and &ldquo;Bob
            Smith Jr&rdquo; cluster together — but the suffix split downgrades
            the confidence so you can spot parent / child pairs at a glance.
          </p>
        </div>

        <div className="flex items-end justify-between gap-3 flex-wrap text-xs">
          <span className="text-muted">
            {groups.length.toLocaleString()} duplicate groups ·{" "}
            {totalRows.toLocaleString()} rows
            {conf ? ` (filtered to ${conf} confidence)` : ""}
          </span>
          <DownloadCsvButton
            rows={csvRows}
            filename={`audit-duplicates${conf ? `-${conf}` : ""}.csv`}
          />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <FilterChip
            label="All"
            count={allGroups.length}
            href="/audit/duplicates"
            active={!conf}
            tone="muted"
          />
          <FilterChip
            label="High confidence"
            count={highCount}
            href="/audit/duplicates?confidence=high"
            active={conf === "high"}
            tone="warn"
          />
          <FilterChip
            label="Low (suffix split)"
            count={lowCount}
            href="/audit/duplicates?confidence=low"
            active={conf === "low"}
            tone="muted"
          />
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border-soft">
                  <th className="text-left font-medium px-5 py-2">Person</th>
                  <th className="text-left font-medium px-5 py-2">
                    Membership type
                  </th>
                  <th className="text-left font-medium px-5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-5 py-10 text-center text-sm text-muted"
                    >
                      No duplicate groups
                      {conf ? ` at ${conf} confidence` : ""}.
                    </td>
                  </tr>
                ) : (
                  groups.map((g) => <DupGroupRows key={g.nameKey} g={g} />)
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function FilterChip({
  label,
  count,
  href,
  active,
  tone,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
  tone: "warn" | "muted";
}) {
  const baseTone = tone === "warn" ? "text-warn-soft-fg" : "text-muted";
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-bg-elev-2 border-accent text-fg"
          : `border-border-soft ${baseTone} hover:border-accent hover:text-fg`
      }`}
    >
      {label} <span className="tnum">{count.toLocaleString()}</span>
    </Link>
  );
}

function DupGroupRows({ g }: { g: DuplicateGroup }) {
  return (
    <>
      <tr className="bg-bg-elev/40 border-b border-border-soft">
        <td colSpan={3} className="px-5 py-2 text-xs text-muted">
          <span className="font-medium text-fg">{g.displayName}</span>
          <span className="ml-2">
            · {g.rows.length} record{g.rows.length === 1 ? "" : "s"}
          </span>
          <Pill
            tone={g.confidence === "high" ? "warn" : "muted"}
            className="ml-2"
          >
            {g.confidence === "high"
              ? "high confidence"
              : "low — suffix split"}
          </Pill>
        </td>
      </tr>
      {g.rows.map((r) => (
        <DupTr key={r.pcoId} r={r} />
      ))}
    </>
  );
}

function DupTr({ r }: { r: DuplicateRow }) {
  return (
    <tr className="border-b border-border-softer hover:bg-bg-elev-2/60">
      <td className="px-5 py-3">
        <a
          href={`https://people.planningcenteronline.com/people/${r.pcoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 group"
          title="Open in PCO"
        >
          <Avatar initials={r.initials} size="sm" />
          <div className="min-w-0">
            <div className="font-medium truncate group-hover:text-accent">
              {r.fullName}{" "}
              {r.suffix && (
                <span className="text-[10px] text-warn-soft-fg uppercase ml-1">
                  {r.suffix}
                </span>
              )}
              <span className="text-[10px] text-subtle group-hover:text-accent">
                {" "}
                ↗
              </span>
            </div>
            <div className="text-xs text-muted">PCO #{r.pcoId}</div>
          </div>
        </a>
      </td>
      <td className="px-5 py-3 text-muted text-xs">
        {r.membershipType ?? <span className="text-subtle">—</span>}
      </td>
      <td className="px-5 py-3 text-muted text-xs">
        {r.status ?? <span className="text-subtle">—</span>}
        {r.inactivatedAt && (
          <Pill tone="warn" className="ml-2">
            inactivated
          </Pill>
        )}
      </td>
    </tr>
  );
}
