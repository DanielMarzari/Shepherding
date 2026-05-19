import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  type CrossAuditRow,
  type DuplicateGroup,
  findDuplicatesAcrossOrg,
} from "@/lib/audit-read";
import { DownloadCsvButton } from "../download-csv";

export default async function DuplicateAuditPage() {
  const session = await requireOrg();
  const groups = findDuplicatesAcrossOrg(session.orgId);
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
            first + last name. Multi-account drift (staff + member + inactive
            record for the same person) shows up here. Fix in PCO directly.
          </p>
        </div>

        <div className="flex items-end justify-between gap-3 flex-wrap text-xs">
          <span className="text-muted">
            {groups.length.toLocaleString()} duplicate groups ·{" "}
            {totalRows.toLocaleString()} rows total
          </span>
          <DownloadCsvButton
            rows={csvRows}
            filename="audit-duplicates.csv"
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
                      No duplicate names found.
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

function DupGroupRows({ g }: { g: DuplicateGroup }) {
  return (
    <>
      <tr className="bg-bg-elev/40 border-b border-border-soft">
        <td colSpan={3} className="px-5 py-2 text-xs text-muted">
          <span className="font-medium text-fg">{g.displayName}</span>
          <span className="ml-2">
            · {g.rows.length} record{g.rows.length === 1 ? "" : "s"}
          </span>
        </td>
      </tr>
      {g.rows.map((r) => (
        <DupTr key={r.pcoId} r={r} />
      ))}
    </>
  );
}

function DupTr({ r }: { r: CrossAuditRow }) {
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
