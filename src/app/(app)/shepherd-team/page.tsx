import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  type Assignment,
  listAssignments,
} from "@/lib/assignments-read";
import { getListByName, listReferenceListNames } from "@/lib/lists-read";
import { listOversightGaps } from "@/lib/oversight-gaps";
import { getShepherdTeamBreakdown } from "@/lib/shepherd-team-read";
import { ShepherdTeamTable } from "./shepherd-team-table";

const SHEPHERD_TEAM_LIST = "REFERENCE - Shepherd Team";

export default async function ShepherdTeamPage() {
  const session = await requireOrg();
  const list = getListByName(session.orgId, SHEPHERD_TEAM_LIST);
  const synced = listReferenceListNames(session.orgId);
  const assignments = listAssignments(session.orgId);
  const gaps = listOversightGaps(session.orgId);

  const byShepherd = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const arr = byShepherd.get(a.shepherdPersonId) ?? [];
    arr.push(a);
    byShepherd.set(a.shepherdPersonId, arr);
  }
  const breakdowns = list
    ? getShepherdTeamBreakdown(
        session.orgId,
        list.members.map((m) => m.personId),
      )
    : new Map();

  return (
    <AppShell active="Shepherd team" breadcrumb="Shepherd team">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Shepherd team
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Synced from the PCO list{" "}
            <span className="text-fg">{SHEPHERD_TEAM_LIST}</span>. Each row
            shows that shepherd&apos;s direct reach broken into four
            non-overlapping buckets. Click a name to set who they oversee and
            what they have agreed to carry.
          </p>
          </div>
          <Link
            href="/shepherd-team/assign"
            className="shrink-0 px-3.5 py-2 rounded border border-border-soft text-[13px] hover:bg-bg-elev-2"
          >
            Assign everyone in Known &rarr;
          </Link>
        </div>

        {!list ? (
          <Card className="p-10 text-center">
            <h3 className="font-semibold mb-2">List not synced yet</h3>
            <p className="text-sm text-muted max-w-md mx-auto">
              Shepherding looks for a PCO People list named{" "}
              <span className="font-mono text-fg">{SHEPHERD_TEAM_LIST}</span>.
              Check that the list exists in PCO, has been refreshed there, and
              that the People entity is enabled on{" "}
              <Link href="/pco" className="text-accent hover:underline">
                /pco
              </Link>
              .
              {synced.length > 0 && (
                <>
                  <br />
                  <span className="text-xs">
                    Synced REFERENCE lists right now: {synced.join(" · ")}
                  </span>
                </>
              )}
            </p>
          </Card>
        ) : (
          <>
            {gaps.peopleAffected > 0 && (
              <div className="rounded-lg border border-warn-soft-fg/40 bg-bg-elev p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div>
                  <div className="text-2xl font-semibold tnum text-warn-soft-fg">
                    {gaps.peopleAffected.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-subtle leading-snug">
                    people we cannot name a shepherd for
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tnum">
                    {gaps.teams.length}
                  </div>
                  <div className="text-[11px] text-subtle leading-snug">
                    teams with nobody connected, of {gaps.liveTeams}
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tnum">
                    {gaps.groups.length}
                  </div>
                  <div className="text-[11px] text-subtle leading-snug">
                    groups with nobody connected, of {gaps.liveGroups}
                  </div>
                </div>
                <p className="text-xs text-muted leading-relaxed flex-1 min-w-[260px]">
                  They are on a live team or group, so somebody is shepherding
                  them &mdash; we just have not recorded who, so a question
                  about them routes to nobody. A hole in the structure, not in
                  the care.
                </p>
                <div className="flex gap-2 shrink-0">
                  <Link
                    href="/shepherd-team/gaps"
                    className="px-3 py-1.5 rounded border border-border-soft text-xs hover:bg-bg-elev-2"
                  >
                    See who &rarr;
                  </Link>
                  <Link
                    href="/shepherd-map"
                    className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium"
                  >
                    Connect them &rarr;
                  </Link>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 max-w-md">
              <Card className="p-4">
                <div className="text-xs text-muted mb-1.5">Team members</div>
                <div className="tnum text-2xl font-semibold">
                  {list.members.length.toLocaleString()}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs text-muted mb-1.5">Last refreshed</div>
                <div className="font-medium">
                  {list.refreshedAt
                    ? new Date(list.refreshedAt).toLocaleString()
                    : "—"}
                </div>
                <div className="text-xs text-muted mt-1">
                  inside PCO (Run-list timestamp)
                </div>
              </Card>
            </div>

            <Card>
              <ShepherdTeamTable
                rows={list.members.map((m) => {
                  const b = breakdowns.get(m.personId);
                  return {
                    personId: m.personId,
                    fullName: m.fullName,
                    initials: m.initials,
                    membershipType: m.membershipType,
                    assignments: byShepherd.get(m.personId) ?? [],
                    staffDirect: b?.staffDirect ?? 0,
                    volunteerLeaders: b?.volunteerLeaders ?? 0,
                    congregants: b?.congregants ?? 0,
                    careNonShepherded: b?.careNonShepherded ?? 0,
                    totalReach: b?.totalReach ?? 0,
                  };
                })}
              />
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
