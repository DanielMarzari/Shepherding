import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill, Stat } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  listLeadPastorIds,
  listShepherdTeamIds,
} from "@/lib/assignments-read";
import { getLeaderOverseersBatch } from "@/lib/shepherd-graph";
import { listShepherds } from "@/lib/shepherds-read";
import { ShepherdsTable } from "./shepherds-table";

export default async function ShepherdsPage() {
  const session = await requireOrg();

  return (
    <AppShell active="Shepherds" breadcrumb="Shepherds">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Shepherds</h1>
            <p className="text-muted text-sm mt-1 max-w-2xl">
              Everyone leading a group or team. Each should be overseen by a
              member of the shepherd team — the rows flagged{" "}
              <span className="text-warn-soft-fg">needs mapping</span> aren&apos;t
              yet, so they still need a connection on the Shepherd map. The lead
              pastor sits at the top — identified by the &ldquo;Everyone else on
              the shepherd team&rdquo; assignment — and is expected to have no
              overseer.
            </p>
          </div>
          <Link
            href="/shepherds/example"
            className="text-xs text-muted hover:text-fg underline"
          >
            View design preview (mock data) →
          </Link>
        </div>

        <Suspense fallback={<OverviewSkeleton />}>
          <ShepherdsOverview orgId={session.orgId} />
        </Suspense>
      </div>
    </AppShell>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] border border-border-soft bg-bg-elev p-4 animate-pulse"
          >
            <div className="h-2.5 w-24 bg-bg-elev-2 rounded mb-3" />
            <div className="h-6 w-12 bg-bg-elev-2/70 rounded" />
          </div>
        ))}
      </div>
      <Card className="p-5 animate-pulse">
        <div className="h-3 w-40 bg-bg-elev-2 rounded mb-4" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-3 bg-bg-elev-2/50 rounded mb-2.5 w-full" />
        ))}
      </Card>
    </div>
  );
}

interface OverseerRef {
  personId: string;
  fullName: string;
  /** "Leads Tuesday Men's Bible Study (Small Groups)" — the led unit
   *  this overseer covers. Title-attribute on the pill. */
  via: string;
}

/** The list + the overseer lookup. Streams in behind a Suspense
 *  boundary so the page header paints immediately. */
async function ShepherdsOverview({ orgId }: { orgId: number }) {
  const shepherds = listShepherds(orgId);
  // The lead pastor is whoever holds the "Everyone else on the shepherd
  // team" assignment — they're the apex, so no overseer is expected.
  const leadPastorIds = new Set(listLeadPastorIds(orgId));
  // This page only counts oversight FROM the shepherd team — getShepherds
  // also surfaces a person's own group/team leaders, which aren't the
  // hierarchy we're auditing here.
  const teamIds = new Set(listShepherdTeamIds(orgId));

  // For each shepherd: who on the shepherd team is assigned (via the
  // shepherd map) to oversee a group / team they LEAD. Membership-only
  // links don't count here — this column is about leader oversight.
  //
  // Batched in one call rather than per-shepherd to kill the N+1 — the
  // previous version ran ~6 queries × N shepherds (600+ on real data).
  const overseersByPerson = getLeaderOverseersBatch(
    orgId,
    shepherds.map((s) => s.personId),
  );
  const rows = shepherds.map((s) => {
    const seen = new Map<string, OverseerRef>();
    for (const link of overseersByPerson.get(s.personId) ?? []) {
      if (!teamIds.has(link.shepherd.personId)) continue;
      const existing = seen.get(link.shepherd.personId);
      if (existing) {
        // Same overseer surfaces through multiple led units — keep the
        // first via and append the others on a new line for the tooltip.
        existing.via += `\n${link.via}`;
      } else {
        seen.set(link.shepherd.personId, {
          personId: link.shepherd.personId,
          fullName: link.shepherd.fullName,
          via: link.via,
        });
      }
    }
    const overseers = [...seen.values()];
    const isLeadPastor = leadPastorIds.has(s.personId);
    return {
      shepherd: s,
      overseers,
      isLeadPastor,
      needsMapping: overseers.length === 0 && !isLeadPastor,
    };
  });

  // Tier order: needs-mapping first (action items), then the lead
  // pastor (apex), then everyone properly overseen — alphabetical
  // within each tier.
  function tier(r: (typeof rows)[number]): number {
    if (r.needsMapping) return 0;
    if (r.isLeadPastor) return 1;
    return 2;
  }
  rows.sort((a, b) => {
    if (tier(a) !== tier(b)) return tier(a) - tier(b);
    return a.shepherd.fullName.localeCompare(b.shepherd.fullName);
  });

  const unmappedCount = rows.filter((r) => r.needsMapping).length;
  const overseenCount = rows.filter((r) => r.overseers.length > 0).length;

  if (shepherds.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-muted">
        No one is flagged as a leader yet. Sync Groups + Teams from PCO and the
        list will populate.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Shepherds" value={shepherds.length.toLocaleString()} />
        <Stat
          label="Overseen"
          value={overseenCount.toLocaleString()}
          valueTone="good"
        />
        <Stat
          label="Needs mapping"
          value={unmappedCount.toLocaleString()}
          valueTone={unmappedCount > 0 ? "warn" : "good"}
          highlight={unmappedCount > 0}
        />
      </div>

      <Card>
        <ShepherdsTable
          rows={rows.map(
            ({ shepherd: s, overseers, isLeadPastor, needsMapping }) => ({
              personId: s.personId,
              fullName: s.fullName,
              initials: s.initials,
              isLeadPastor,
              needsMapping,
              overseers,
              groupsLed: s.groupsLed,
              teamsLed: s.teamsLed,
            }),
          )}
        />
      </Card>
    </div>
  );
}
