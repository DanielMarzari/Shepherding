import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import {
  getAssignBuckets,
  getAssignShepherds,
  getCandidates,
} from "@/lib/shepherd-assign";
import { PersonCard } from "../person-card";
import { AutoAssignButton } from "../bulk-button";

/** The pool: nobody named these people, which is most of them.
 *
 *  Same card as contested, except the choices are whoever still has room.
 *  Anyone already assigned is excluded by the query, so nobody appears
 *  twice and the count only ever goes down.
 */
export default async function PoolPage() {
  const session = await requireOrg();
  const buckets = getAssignBuckets(session.orgId);
  const shepherds = getAssignShepherds(session.orgId);
  const people = getCandidates(session.orgId, "pool", 50);

  return (
    <AppShell active="Assignment" breadcrumb="Shepherd team › Pool">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[.11em] text-subtle">
              <Link href="/shepherd-team/assign" className="hover:underline">
                Assignment
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">
              Assign the pool
            </h1>
            <p className="text-muted text-sm mt-1.5 max-w-2xl leading-relaxed">
              Nobody has named these people. Same card, except the choices are
              whoever still has room — or stop choosing and let the whole lot
              go at once.
            </p>
          </div>
          <span className="text-xs text-subtle tnum">
            {buckets.pool.toLocaleString()} unassigned
          </span>
        </div>

        <AutoAssignButton
          count={buckets.pool}
          isAdmin={session.role === "admin"}
        />

        <PersonCard
          people={people}
          shepherds={shepherds}
          heading="Shepherds with room — most first"
          source="manual"
          emptyTitle="The pool is empty"
          emptyBody="Everyone in Known that nobody had named now has a shepherd."
        />
      </div>
    </AppShell>
  );
}
