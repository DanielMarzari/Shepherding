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
} from "../assign/assign-overview";
import { ExpandingTable } from "./expanding-table";

/** The assignment page, with a shepherd's own page folded into the row.
 *
 *  Staged beside /shepherd-team/assign rather than replacing it, so the
 *  two can be looked at against the same data before either is chosen.
 *  Everything above the coverage table is the same component on both —
 *  the table is the only thing being compared.
 */
export default async function AssignInlinePage() {
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
    <AppShell active="Assignment" breadcrumb="Shepherd team › Assignment (expanding)">
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
              should be assigned to someone on the shepherd team. Click a
              shepherd&rsquo;s name in the table below to open what they
              oversee underneath it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/shepherd-team/bandwidth"
              className="shrink-0 px-3.5 py-2 rounded border border-border-soft text-[13px] hover:bg-bg-elev-2"
            >
              Set bandwidths &rarr;
            </Link>
            <Link
              href="/shepherd-team/assign"
              className="shrink-0 px-3.5 py-2 rounded border border-dashed border-border-soft text-[13px] text-muted hover:bg-bg-elev-2"
            >
              &larr; Back to the current version
            </Link>
          </div>
        </div>

        <CapacityCard cap={cap} />
        <WhatNeedsDeciding buckets={buckets} isAdmin={isAdmin} />
        <ExpandingTable shepherds={shepherds} isAdmin={isAdmin} />
      </div>
    </AppShell>
  );
}
