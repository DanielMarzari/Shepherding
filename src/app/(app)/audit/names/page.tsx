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
}

const FLAG_LABELS: Record<NameFlag, { label: string; tone: "warn" | "muted" }> = {
  "junk-name": { label: "junk name", tone: "warn" },
  "weird-name": { label: "weird name", tone: "muted" },
};

export default async function NameAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const allRows = findNameIssuesAcrossOrg(session.orgId);

  const counts: Record<NameFlag, number> = { "junk-name": 0, "weird-name": 0 };
  for (const r of allRows) for (const f of r.flags) counts[f]++;

  const flagFilter = params.flag as NameFlag | undefined;
  const visible = flagFilter
    ? allRows.filter((r) => r.flags.includes(flagFilter))
    : allRows;

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
            {allRows.length.toLocaleString()} flagged rows
          </span>
          <DownloadCsvButton
            rows={visible.map((r) => ({ pcoId: r.pcoId, fullName: r.fullName }))}
            filename={`audit-names${flagFilter ? `-${flagFilter}` : ""}.csv`}
          />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <FilterChip
            label="All flagged"
            count={allRows.length}
            href="/audit/names"
            active={!flagFilter}
            tone="muted"
          />
          {(Object.keys(FLAG_LABELS) as NameFlag[]).map((f) => (
            <FilterChip
              key={f}
              label={FLAG_LABELS[f].label}
              count={counts[f]}
              href={`/audit/names?flag=${f}`}
              active={flagFilter === f}
              tone={FLAG_LABELS[f].tone}
            />
          ))}
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
