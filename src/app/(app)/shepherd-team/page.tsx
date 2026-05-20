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

const SHEPHERD_TEAM_LIST = "REFERENCE - Shepherd Team";

const KIND_TONES: Record<TargetKind, "muted" | "accent" | "warn" | "good"> = {
  group: "accent",
  group_type: "muted",
  team: "good",
  service_type: "muted",
  team_position: "good",
  person: "warn",
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

  return (
    <AppShell active="Shepherd team" breadcrumb="Shepherd team">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Shepherd team
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Synced from the PCO list{" "}
            <span className="text-fg">{SHEPHERD_TEAM_LIST}</span>. Each card
            shows what that shepherd oversees — set those connections on the{" "}
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

            <div className="space-y-3">
              {list.members.map((m) => (
                <ShepherdCard
                  key={m.personId}
                  personId={m.personId}
                  fullName={m.fullName}
                  initials={m.initials}
                  isMinor={m.isMinor}
                  membershipType={m.membershipType}
                  assignments={byShepherd.get(m.personId) ?? []}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function ShepherdCard({
  personId,
  fullName,
  initials,
  isMinor,
  membershipType,
  assignments,
}: {
  personId: string;
  fullName: string;
  initials: string;
  isMinor: boolean;
  membershipType: string | null;
  assignments: Assignment[];
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-3">
        <Avatar initials={initials} size="sm" />
        <div className="min-w-0">
          <Link
            href={`/people/${personId}`}
            className="font-medium truncate hover:text-accent"
          >
            {fullName}
          </Link>
          <div className="text-xs text-muted">
            {isMinor ? "Kid" : "Adult"}
            {membershipType ? ` · ${membershipType}` : ""}
            {" · "}
            {assignments.length === 0
              ? "no assignments"
              : `${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`}
          </div>
        </div>
      </div>

      {assignments.length > 0 ? (
        <ul className="space-y-1.5">
          {assignments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 text-sm flex-wrap"
            >
              <Pill tone={KIND_TONES[a.targetKind]}>
                {TARGET_KIND_LABELS[a.targetKind]}
              </Pill>
              <span className="truncate">{a.targetName}</span>
              {a.note && (
                <span className="text-xs text-muted italic truncate">
                  — {a.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-subtle">
          Nothing assigned yet. Add connections on the{" "}
          <Link href="/shepherd-map" className="text-accent hover:underline">
            Shepherd map
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
