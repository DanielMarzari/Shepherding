import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import {
  getAssignBuckets,
  getAssignCapacity,
  getAssignShepherds,
} from "@/lib/shepherd-assign";
import {
  CapacityCard,
  NoTeamYet,
  WhatNeedsDeciding,
} from "./assign-overview";
import { BandwidthTable } from "./bandwidth-table";

/** The assignment page.
 *
 *  Everyone in Known should be somebody's responsibility. Capacity sits at
 *  the top because on real data it is the binding constraint, not a
 *  footnote: 4,543 known adults across 25 shepherds is 182 each, and
 *  whether that is reasonable is a question only the church can answer —
 *  which is why bandwidth is set here rather than assumed.
 */
export default async function AssignPage() {
  const session = await requireOrg();
  const cap = getAssignCapacity(session.orgId);
  const buckets = getAssignBuckets(session.orgId);
  const shepherds = getAssignShepherds(session.orgId);
  const isAdmin = session.role === "admin";

  if (cap.shepherds === 0) {
    return (
      <AppShell active="Assignment" breadcrumb="Shepherd team › Assignment">
        <div className="px-5 md:px-7 py-7">
          <NoTeamYet />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="Assignment" breadcrumb="Shepherd team › Assignment">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[.11em] text-subtle">
              Shepherd team
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">
              Assignment
            </h1>
            <p className="text-muted text-sm mt-1.5 max-w-2xl leading-relaxed">
              Everyone who is{" "}
              <strong className="text-fg">Known</strong>{" "}
              should be assigned to someone on the shepherd team.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/shepherd-team"
              className="shrink-0 px-3.5 py-2 rounded border border-border-soft text-[13px] hover:bg-bg-elev-2"
            >
              Set who they oversee &rarr;
            </Link>
            <Link
              href="/shepherd-team/bandwidth"
              className="shrink-0 px-3.5 py-2 rounded border border-border-soft text-[13px] hover:bg-bg-elev-2"
            >
              Set bandwidths &rarr;
            </Link>
            <Link
              href="/shepherd-team/assign-inline"
              className="shrink-0 px-3.5 py-2 rounded border border-dashed border-border-soft text-[13px] text-muted hover:bg-bg-elev-2"
            >
              Try the expanding version &rarr;
            </Link>
          </div>
        </div>

        <CapacityCard cap={cap} />
        <WhatNeedsDeciding buckets={buckets} isAdmin={isAdmin} />
        <BandwidthTable shepherds={shepherds} isAdmin={isAdmin} />
      </div>
    </AppShell>
  );
}
