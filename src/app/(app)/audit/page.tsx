import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  type AuditFlag,
  type AuditRow,
  auditMembershipType,
} from "@/lib/audit-read";
import { getMembershipTypeStats } from "@/lib/pco";

interface SearchParams {
  type?: string;
  flag?: string;
}

const FLAG_LABELS: Record<AuditFlag, { label: string; tone: "warn" | "muted" | "accent" }> = {
  deceased: { label: "deceased", tone: "warn" },
  inactive: { label: "inactive", tone: "warn" },
  "junk-name": { label: "junk name", tone: "warn" },
  "weird-name": { label: "weird name", tone: "muted" },
  "no-birthdate": { label: "no birthdate", tone: "muted" },
  "possible-duplicate": { label: "possible duplicate", tone: "warn" },
  "stale-pco-record": { label: "stale 6mo+", tone: "muted" },
  "no-activity-no-rosters": { label: "no activity", tone: "muted" },
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const memTypes = getMembershipTypeStats(session.orgId);
  const requestedType = params.type ?? "Member";
  const validType =
    memTypes.find((t) => t.membershipType === requestedType)?.membershipType ??
    memTypes[0]?.membershipType ??
    "Member";
  const audit = auditMembershipType(session.orgId, validType);
  const flagFilter = params.flag as AuditFlag | undefined;
  const visible = flagFilter
    ? audit.rows.filter((r) => r.flags.includes(flagFilter))
    : audit.rows;

  return (
    <AppShell active="Membership audit" breadcrumb="Membership audit">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Membership audit
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            One-time cleanup view. Flags rows in your member roster that look
            wrong — deceased, long-inactive, junk names, possible duplicates,
            etc. Fix them in PCO directly; this page doesn&apos;t write
            anything back.
          </p>
        </div>

        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <form action="/audit" method="get" className="flex items-center gap-2">
              <span className="text-muted">Membership type:</span>
              <select
                name="type"
                defaultValue={validType}
                className="bg-bg-elev border border-border-soft rounded px-2 py-1 text-fg cursor-pointer"
              >
                {memTypes.map((t) => (
                  <option
                    key={t.membershipType ?? "__null__"}
                    value={t.membershipType ?? ""}
                  >
                    {t.membershipType ?? "(none)"} ({t.count})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-2 py-1 rounded border border-border-soft text-muted hover:text-fg"
              >
                Go
              </button>
            </form>
            <span className="text-muted">
              {audit.totalScanned.toLocaleString()} people in &ldquo;
              {audit.membershipType}&rdquo;
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <FilterChip
            label="All flagged"
            count={audit.rows.filter((r) => r.flags.length > 0).length}
            href={`/audit?type=${encodeURIComponent(validType)}`}
            active={!flagFilter}
            tone="muted"
          />
          {(Object.keys(FLAG_LABELS) as AuditFlag[]).map((f) => (
            <FilterChip
              key={f}
              label={FLAG_LABELS[f].label}
              count={audit.flagCounts[f]}
              href={`/audit?type=${encodeURIComponent(validType)}&flag=${f}`}
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
                  <th className="text-left font-medium px-5 py-2">Status</th>
                  <th className="text-right font-medium px-5 py-2">Groups</th>
                  <th className="text-right font-medium px-5 py-2">Teams</th>
                  <th className="text-right font-medium px-5 py-2">
                    Check-ins (90d)
                  </th>
                  <th className="text-right font-medium px-5 py-2">PCO updated</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-10 text-center text-sm text-muted"
                    >
                      No rows
                      {flagFilter ? ` flagged "${FLAG_LABELS[flagFilter].label}"` : " flagged"}
                      .
                    </td>
                  </tr>
                ) : (
                  visible.map((r) => <AuditTr key={r.pcoId} r={r} />)
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
  tone: "warn" | "muted" | "accent";
}) {
  const baseTone =
    tone === "warn"
      ? "text-warn-soft-fg"
      : tone === "accent"
        ? "text-accent"
        : "text-muted";
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

function AuditTr({ r }: { r: AuditRow }) {
  return (
    <tr className="border-b border-border-softer hover:bg-bg-elev-2/60">
      <td className="px-5 py-3">
        <Link
          href={`/people/${r.pcoId}`}
          className="flex items-center gap-3 group"
        >
          <Avatar initials={r.initials} size="sm" />
          <div className="min-w-0">
            <div className="font-medium truncate group-hover:text-accent">
              {r.fullName}
            </div>
            <div className="text-xs text-muted">PCO #{r.pcoId}</div>
          </div>
        </Link>
      </td>
      <td className="px-5 py-3">
        {r.flags.length === 0 ? (
          <span className="text-xs text-subtle">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.flags.map((f) => (
              <Pill key={f} tone={FLAG_LABELS[f].tone}>
                {FLAG_LABELS[f].label}
              </Pill>
            ))}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-muted text-xs">
        {r.status ?? <span className="text-subtle">—</span>}
        {r.isMinor && <span className="ml-2 text-warn-soft-fg">kid</span>}
        {r.inactivatedAt && (
          <span className="ml-2 text-warn-soft-fg">inactivated</span>
        )}
      </td>
      <td className="px-5 py-3 text-right tnum">{r.groupsCount}</td>
      <td className="px-5 py-3 text-right tnum">{r.teamsCount}</td>
      <td className="px-5 py-3 text-right tnum">{r.recentCheckins}</td>
      <td className="px-5 py-3 text-right tnum text-xs text-muted">
        {r.pcoUpdatedAt
          ? new Date(r.pcoUpdatedAt).toLocaleDateString()
          : "—"}
      </td>
    </tr>
  );
}
