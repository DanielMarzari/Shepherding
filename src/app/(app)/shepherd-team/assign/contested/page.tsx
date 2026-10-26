import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import {
  getAssignBuckets,
  getAssignShepherds,
  getCandidates,
} from "@/lib/shepherd-assign";
import { PersonCard } from "../person-card";

/** Contested: two or more shepherds named the same person.
 *
 *  Only the claimants are offered. Somebody who never said they knew this
 *  person is not a candidate here — that is what the pool is for.
 */
export default async function ContestedPage() {
  const session = await requireOrg();
  const buckets = getAssignBuckets(session.orgId);
  const shepherds = getAssignShepherds(session.orgId);
  const people = getCandidates(session.orgId, "contested", 50);

  return (
    <AppShell active="Assignment" breadcrumb="Shepherd team › Contested">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[.11em] text-subtle">
              <Link href="/shepherd-team/assign" className="hover:underline">
                Assignment
              </Link>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">
              Contested
            </h1>
            <p className="text-muted text-sm mt-1.5 max-w-2xl leading-relaxed">
              Two or more shepherds named the same person. Pick one and it
              advances.
            </p>
          </div>
          <span className="text-xs text-subtle tnum">
            {buckets.contested.toLocaleString()} to settle
          </span>
        </div>

        <PersonCard
          people={people}
          shepherds={shepherds}
          heading={
            people[0]?.claimedBy.length
              ? `${people[0].claimedBy.length} shepherds named them`
              : "Who takes them?"
          }
          source="contested"
          emptyTitle="Nothing contested"
          emptyBody="Every person two shepherds disagreed about has been settled. The pool is where the rest of the work is."
        />
      </div>
    </AppShell>
  );
}
