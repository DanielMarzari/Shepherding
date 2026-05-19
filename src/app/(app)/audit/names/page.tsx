import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  type NameFlag,
  type NameIssueRow,
  findNameIssuesAcrossOrg,
} from "@/lib/audit-read";
import { DownloadCsvButton } from "../download-csv";

interface SearchParams {
  flag?: string;
  status?: string;
}

const FLAG_LABELS: Record<NameFlag, { label: string; tone: "warn" | "muted" }> = {
  "junk-name": { label: "junk name", tone: "warn" },
  "weird-name": { label: "weird name", tone: "muted" },
};

const STATUS_ALL = "__all__";

/** Default status filter — most cleanup attention should go to live
 *  accounts, so we open the page already filtered to "active". Users
 *  can switch to "all" or any other status via the chips. */
const DEFAULT_STATUS = "active";

function normalizeStatus(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase() || "(none)";
}

export default async function NameAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const allRows = findNameIssuesAcrossOrg(session.orgId);

  const statusCounts = new Map<string, number>();
  for (const r of allRows) {
    const s = normalizeStatus(r.status);
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }
  // Stable status chip order: active first, inactive second, then
  // whatever else is in the data alphabetically.
  const knownOrder = ["active", "inactive"];
  const distinctStatuses = Array.from(statusCounts.keys()).sort((a, b) => {
    const ai = knownOrder.indexOf(a);
    const bi = knownOrder.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }
    return a.localeCompare(b);
  });

  const requestedStatus = params.status ?? DEFAULT_STATUS;
  const statusFilter =
    requestedStatus === STATUS_ALL
      ? null
      : statusCounts.has(requestedStatus)
        ? requestedStatus
        : null;

  const flagFilter = params.flag as NameFlag | undefined;

  const visible = allRows.filter((r) => {
    if (statusFilter && normalizeStatus(r.status) !== statusFilter) return false;
    if (flagFilter && !r.flags.includes(flagFilter)) return false;
    return true;
  });

  // Flag chip counts honor the status filter so the numbers actually
  // match what you'll see in the table.
  const counts: Record<NameFlag, number> = { "junk-name": 0, "weird-name": 0 };
  for (const r of allRows) {
    if (statusFilter && normalizeStatus(r.status) !== statusFilter) continue;
    for (const f of r.flags) counts[f]++;
  }
  const totalAtStatus = statusFilter
    ? (statusCounts.get(statusFilter) ?? 0)
    : allRows.length;

  function hrefWith(overrides: { status?: string | null; flag?: string | null }): string {
    const q = new URLSearchParams();
    const status =
      overrides.status === undefined
        ? statusFilter ?? STATUS_ALL
        : overrides.status;
    const flag = overrides.flag === undefined ? flagFilter ?? null : overrides.flag;
    if (status && status !== DEFAULT_STATUS) q.set("status", status);
    if (flag) q.set("flag", flag);
    const qs = q.toString();
    return qs ? `/audit/names?${qs}` : "/audit/names";
  }

  return (
    <AppShell active="Name audit" breadcrumb="Name audit">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Name audit</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Cross-org scan for records where the name looks wrong — empty,
            punctuation-only, contains digits, single-letter components, or
            repeated characters. Often these are placeholder or test rows
            someone forgot to clean up.
          </p>
        </div>

        <div className="flex items-end justify-between gap-3 flex-wrap text-xs">
          <span className="text-muted">
            {visible.length.toLocaleString()} of{" "}
            {totalAtStatus.toLocaleString()} flagged
            {statusFilter ? ` (${statusFilter} only)` : ""}
          </span>
          <DownloadCsvButton
            rows={visible.map((r) => ({ pcoId: r.pcoId, fullName: r.fullName }))}
            filename={`audit-names${statusFilter ? `-${statusFilter}` : ""}${flagFilter ? `-${flagFilter}` : ""}.csv`}
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-subtle uppercase tracking-wider text-[10px] mr-1">
              Status
            </span>
            <FilterChip
              label="All"
              count={allRows.length}
              href={hrefWith({ status: STATUS_ALL })}
              active={!statusFilter}
              tone="muted"
            />
            {distinctStatuses.map((s) => (
              <FilterChip
                key={s}
                label={s}
                count={statusCounts.get(s) ?? 0}
                href={hrefWith({ status: s })}
                active={statusFilter === s}
                tone={s === "inactive" ? "muted" : "warn"}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-subtle uppercase tracking-wider text-[10px] mr-1">
              Flag
            </span>
            <FilterChip
              label="All flagged"
              count={totalAtStatus}
              href={hrefWith({ flag: null })}
              active={!flagFilter}
              tone="muted"
            />
            {(Object.keys(FLAG_LABELS) as NameFlag[]).map((f) => (
              <FilterChip
                key={f}
                label={FLAG_LABELS[f].label}
                count={counts[f]}
                href={hrefWith({ flag: f })}
                active={flagFilter === f}
                tone={FLAG_LABELS[f].tone}
              />
            ))}
          </div>
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border-soft">
                  <th className="text-left font-medium px-5 py-2">Person</th>
                  <th className="text-left font-medium px-5 py-2">Flags</th>
                  <th className="text-left font-medium px-5 py-2">
                    Membership type
                  </th>
                  <th className="text-left font-medium px-5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-10 text-center text-sm text-muted"
                    >
                      No rows flagged.
                    </td>
                  </tr>
                ) : (
                  visible.map((r) => <NameTr key={r.pcoId} r={r} />)
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

function NameTr({ r }: { r: NameIssueRow }) {
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
              <span className="text-[10px] text-subtle group-hover:text-accent">
                ↗
              </span>
            </div>
            <div className="text-xs text-muted">PCO #{r.pcoId}</div>
          </div>
        </a>
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-wrap gap-1">
          {r.flags.map((f) => (
            <Pill key={f} tone={FLAG_LABELS[f].tone}>
              {FLAG_LABELS[f].label}
            </Pill>
          ))}
        </div>
      </td>
      <td className="px-5 py-3 text-muted text-xs">
        {r.membershipType ?? <span className="text-subtle">—</span>}
      </td>
      <td className="px-5 py-3 text-muted text-xs">
        {r.status ?? <span className="text-subtle">—</span>}
      </td>
    </tr>
  );
}
