import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  TARGET_KIND_LABELS,
  type Assignment,
  type TargetKind,
  listAssignments,
} from "@/lib/assignments-read";
import { getListByName, listReferenceListNames } from "@/lib/lists-read";
import { getShepherdTeamBreakdown } from "@/lib/shepherd-team-read";

const SHEPHERD_TEAM_LIST = "REFERENCE - Shepherd Team";

const KIND_TONES: Record<TargetKind, "muted" | "accent" | "warn" | "good"> = {
  group: "accent",
  group_type: "muted",
  team: "good",
  service_type: "muted",
  team_position: "good",
  person: "warn",
  membership_type: "accent",
  shepherd_team: "warn",
  reference_list: "muted",
};

export default async function ShepherdTeamPage() {
  const session = await requireOrg();
  const list = getListByName(session.orgId, SHEPHERD_TEAM_LIST);
  const synced = listReferenceListNames(session.orgId);
  const assignments = listAssignments(session.orgId);

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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Shepherd team
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Synced from the PCO list{" "}
            <span className="text-fg">{SHEPHERD_TEAM_LIST}</span>. Each row
            shows that shepherd&apos;s direct reach broken into four
            non-overlapping buckets — set the underlying connections on the{" "}
            <Link href="/shepherd-map" className="text-accent hover:underline">
              Shepherd map
            </Link>
            .
          </p>
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-border-soft">
                      <th className="text-left font-medium px-5 py-2.5">
                        Person
                      </th>
                      <th className="text-left font-medium px-5 py-2.5">
                        Assignments
                      </th>
                      <th
                        className="text-right font-medium px-3 py-2.5"
                        title="Distinct leaders of groups/teams this shepherd oversees via the shepherd map."
                      >
                        Volunteer leaders
                      </th>
                      <th
                        className="text-right font-medium px-3 py-2.5"
                        title="Distinct non-leader members of groups/teams this shepherd directly leads in PCO."
                      >
                        Congregants
                      </th>
                      <th
                        className="text-right font-medium px-3 py-2.5"
                        title="Care-map assignments to people not currently in any group or team."
                      >
                        Care (non-shep.)
                      </th>
                      <th
                        className="text-right font-medium px-3 py-2.5"
                        title="Staff list members directly assigned to this shepherd who aren't already counted in the other three buckets."
                      >
                        Staff (direct)
                      </th>
                      <th className="text-right font-medium px-5 py-2.5">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.members.map((m) => (
                      <ShepherdRow
                        key={m.personId}
                        personId={m.personId}
                        fullName={m.fullName}
                        initials={m.initials}
                        membershipType={m.membershipType}
                        assignments={byShepherd.get(m.personId) ?? []}
                        breakdown={breakdowns.get(m.personId) ?? null}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function ShepherdRow({
  personId,
  fullName,
  initials,
  membershipType,
  assignments,
  breakdown,
}: {
  personId: string;
  fullName: string;
  initials: string;
  membershipType: string | null;
  assignments: Assignment[];
  breakdown: {
    volunteerLeaders: number;
    congregants: number;
    careNonShepherded: number;
    staffDirect: number;
    totalReach: number;
  } | null;
}) {
  return (
    <tr className="border-b border-border-softer hover:bg-bg-elev-2/60 align-top">
      <td className="px-5 py-3.5 min-w-[220px]">
        <div className="flex items-center gap-3">
          <Avatar initials={initials} size="sm" />
          <div className="min-w-0">
            <Link
              href={`/people/${personId}`}
              className="font-medium truncate hover:text-accent"
            >
              {fullName}
            </Link>
            {membershipType && (
              <div className="text-xs text-muted truncate">
                {membershipType}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-5 py-3.5">
        {assignments.length === 0 ? (
          <span className="text-xs text-subtle">No assignments yet</span>
        ) : (
          <ul className="space-y-1 max-w-md">
            {assignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 text-xs flex-wrap"
              >
                <Pill tone={KIND_TONES[a.targetKind]}>
                  {TARGET_KIND_LABELS[a.targetKind]}
                </Pill>
                <span className="truncate">{a.targetName}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
      <BreakdownCell value={breakdown?.volunteerLeaders ?? 0} tone="good" />
      <BreakdownCell value={breakdown?.congregants ?? 0} tone="accent" />
      <BreakdownCell value={breakdown?.careNonShepherded ?? 0} tone="warn" />
      <BreakdownCell value={breakdown?.staffDirect ?? 0} tone="muted" />
      <td className="px-5 py-3.5 text-right tnum font-medium">
        {breakdown?.totalReach.toLocaleString() ?? "—"}
      </td>
    </tr>
  );
}

function BreakdownCell({
  value,
  tone,
}: {
  value: number;
  tone: "good" | "accent" | "warn" | "muted";
}) {
  const cls =
    value === 0
      ? "text-subtle"
      : tone === "good"
        ? "text-good-soft-fg"
        : tone === "accent"
          ? "text-accent"
          : tone === "warn"
            ? "text-warn-soft-fg"
            : "text-muted";
  return (
    <td className={`px-3 py-3.5 text-right tnum ${cls}`}>
      {value === 0 ? "—" : value.toLocaleString()}
    </td>
  );
}
