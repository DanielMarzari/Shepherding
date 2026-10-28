import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { listOversightGaps, listUntracedPeople } from "@/lib/oversight-gaps";
import { UntracedTable } from "./untraced-table";

/** Who we cannot name a shepherd for.
 *
 *  Everyone here is on a live team or group, so somebody is shepherding
 *  them — that is what being on a roster means. What is missing is the
 *  connection saying who, which makes this a hole in the structure rather
 *  than a list of neglected people, and it is why the fix is on the
 *  shepherd map and not on this page.
 */
export default async function OversightGapsPage() {
  const session = await requireOrg();
  const gaps = listOversightGaps(session.orgId);
  const people = listUntracedPeople(session.orgId);

  return (
    <AppShell active="Shepherd team" breadcrumb="Shepherd team › Gaps">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[.11em] text-subtle">
              Shepherd team
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">
              Nobody we can name
            </h1>
            <p className="text-muted text-sm mt-1.5 max-w-2xl leading-relaxed">
              These people are on a live team or group, so somebody is
              shepherding them. The system cannot say who, because nobody on
              the shepherd team is connected to that roster &mdash; which
              means we cannot route a question about them to anyone.
            </p>
          </div>
          <Link
            href="/shepherd-map"
            className="shrink-0 px-3.5 py-2 rounded bg-accent text-[var(--accent-fg)] text-[13px] font-medium"
          >
            Connect the rosters &rarr;
          </Link>
        </div>

        <div className="rounded-lg border border-border-soft bg-bg-elev p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat n={people.length} label="people we cannot trace" tone="warn" />
            <Stat
              n={gaps.teams.length}
              label={`teams with nobody connected, of ${gaps.liveTeams}`}
            />
            <Stat
              n={gaps.groups.length}
              label={`groups with nobody connected, of ${gaps.liveGroups}`}
            />
            <Stat
              n={gaps.teams.length + gaps.groups.length}
              label="connections that would close it"
            />
          </div>
          <p className="text-xs text-subtle mt-3.5 leading-relaxed max-w-3xl">
            Fewer connections than that will do it in practice &mdash;
            connecting a whole service type or group type covers every
            roster under it at once. The shepherd map lists them biggest
            first and says which types are worth taking.
          </p>
        </div>

        <UntracedTable people={people} />
      </div>
    </AppShell>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "warn";
}) {
  return (
    <div>
      <div
        className={`text-2xl font-semibold tnum ${
          tone === "warn" ? "text-warn-soft-fg" : ""
        }`}
      >
        {n.toLocaleString()}
      </div>
      <div className="text-[11px] text-subtle leading-snug">{label}</div>
    </div>
  );
}
