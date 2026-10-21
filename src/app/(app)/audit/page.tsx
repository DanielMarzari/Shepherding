import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { getMembershipAudit } from "@/lib/membership-audit";
import { MembershipAuditView } from "./membership-audit-view";

/** Membership audit.
 *
 *  Rebuilt on person_activity rather than a request-time aggregate over
 *  every activity source: the old version took 3.6 s on 1,078 members and
 *  got worse as the check-in table grew. The trade is that everything here
 *  is as of the last snapshot refresh, which the page states rather than
 *  implying it is live.
 */
/** Members only, deliberately. This page asks whether the people who have
 *  committed to membership are actually in a lane; the same question of a
 *  visitor or a contributor-only record means something different, and
 *  /audit/membership-fit is where type-vs-behaviour belongs. */
const MEMBERSHIP_TYPE = "Member";

export default async function AuditPage() {
  const session = await requireOrg();
  const validType = MEMBERSHIP_TYPE;
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
