import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { getMembershipTypeStats } from "@/lib/pco";
import { getMembershipAudit } from "@/lib/membership-audit";
import { DownloadCsvButton } from "./download-csv";
import { MembershipAuditView } from "./membership-audit-view";

interface SearchParams {
  type?: string;
}

/** Membership audit.
 *
 *  Rebuilt on person_activity rather than a request-time aggregate over
 *  every activity source: the old version took 3.6 s on 1,078 members and
 *  got worse as the check-in table grew. The trade is that everything here
 *  is as of the last snapshot refresh, which the page states rather than
 *  implying it is live.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const memTypes = getMembershipTypeStats(session.orgId);
  const requested = params.type ?? "Member";
  const validType =
    memTypes.find((t) => t.membershipType === requested)?.membershipType ??
    memTypes[0]?.membershipType ??
    "Member";

  const audit = getMembershipAudit(session.orgId, validType);

  const refreshed = audit.refreshedAt
    ? new Date(audit.refreshedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <AppShell active="Membership audit" breadcrumb="Membership audit">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[.11em] text-subtle">
              Audit
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">
              Membership
            </h1>
            <p className="text-muted text-sm mt-1.5 max-w-2xl leading-relaxed">
              Every member and the lanes they actually show up in. Click a band
              to filter; the one you picked stays outlined.{" "}
              <Link
                href="/audit/membership-fit"
                className="text-accent hover:underline"
              >
                Whether people are in the right membership type is a separate
                audit &rarr;
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <form action="/audit" method="get" className="flex items-center gap-2">
              <label htmlFor="type" className="text-xs text-muted">
                Type
              </label>
              <select
                id="type"
                name="type"
                defaultValue={validType}
                className="bg-bg-elev border border-border-soft rounded-md px-2.5 py-1.5 text-[13px] text-fg cursor-pointer"
              >
                {memTypes.map((t) => (
                  <option
                    key={t.membershipType ?? "__null__"}
                    value={t.membershipType ?? ""}
                  >
                    {t.membershipType ?? "(none)"} ({t.count.toLocaleString()})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-md border border-border-soft text-muted hover:text-fg text-[13px]"
              >
                Go
              </button>
            </form>
            <DownloadCsvButton
              rows={audit.rows.map((r) => ({
                pcoId: r.pcoId,
                fullName: r.fullName,
              }))}
              filename={`membership-audit-${validType.replace(/\s+/g, "-").toLowerCase()}.csv`}
            />
          </div>
        </div>

        {audit.total === 0 ? (
          <div className="rounded-lg border border-border-soft bg-bg-elev px-5 py-12 text-center text-sm text-muted">
            No people in &ldquo;{validType}&rdquo;.
          </div>
        ) : (
          <MembershipAuditView audit={audit} />
        )}

        <p className="text-xs text-subtle">
          {audit.total.toLocaleString()} people in &ldquo;{validType}&rdquo; ·
          lanes and connection as of the snapshot
          {refreshed ? ` refreshed ${refreshed}` : " (never refreshed)"} ·{" "}
          <Link
            href="/pco/filters?tab=outreach"
            className="text-accent hover:underline"
          >
            what counts as Outreach
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
