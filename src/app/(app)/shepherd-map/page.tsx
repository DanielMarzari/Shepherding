import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  TARGET_KIND_LABELS,
  type Assignment,
  type ShepherdPerson,
  type TargetKind,
  type TargetOption,
  listAssignments,
  listShepherds,
  listTargetOptions,
} from "@/lib/assignments-read";
import { AddAssignmentForm } from "./AddAssignmentForm";
import { removeAssignmentAction } from "./actions";

const KIND_TONES: Record<TargetKind, "muted" | "accent" | "warn" | "good"> = {
  group: "accent",
  group_type: "muted",
  team: "good",
  service_type: "muted",
  team_position: "good",
  person: "warn",
};

export default async function ShepherdMapPage() {
  const session = await requireOrg();
  const shepherds = listShepherds(session.orgId);
  const assignments = listAssignments(session.orgId);

  const targetsByKind: Record<TargetKind, TargetOption[]> = {
    group: listTargetOptions(session.orgId, "group"),
    group_type: listTargetOptions(session.orgId, "group_type"),
    team: listTargetOptions(session.orgId, "team"),
    service_type: listTargetOptions(session.orgId, "service_type"),
    team_position: listTargetOptions(session.orgId, "team_position"),
    person: listTargetOptions(session.orgId, "person"),
  };

  const byShepherd = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const arr = byShepherd.get(a.shepherdPersonId) ?? [];
    arr.push(a);
    byShepherd.set(a.shepherdPersonId, arr);
  }

  const isAdmin = session.role === "admin";

  return (
    <AppShell active="Shepherd map" breadcrumb="Shepherd map">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shepherd map</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Connect each staff shepherd to the people they oversee. A
            connection can point at a specific group or team, an entire
            group type / service type, a single position on a team, or
            another shepherd (peer hierarchy). Shepherd team membership is
            synced from the PCO list{" "}
            <span className="text-fg">REFERENCE - Shepherd Team</span>; edit
            that list in PCO to add or remove people.
          </p>
        </div>

        {shepherds.length === 0 ? (
          <Card className="p-6 text-sm text-muted">
            No one is on the <span className="text-fg">REFERENCE - Shepherd Team</span>{" "}
            PCO list yet. Add people to that list in PCO and re-sync to
            populate this page.
          </Card>
        ) : (
          <div className="space-y-3">
            {shepherds.map((s) => (
              <ShepherdCard
                key={s.personId}
                shepherd={s}
                assignments={byShepherd.get(s.personId) ?? []}
                targetsByKind={targetsByKind}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ShepherdCard({
  shepherd,
  assignments,
  targetsByKind,
  isAdmin,
}: {
  shepherd: ShepherdPerson;
  assignments: Assignment[];
  targetsByKind: Record<TargetKind, TargetOption[]>;
  isAdmin: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-3">
        <Avatar initials={shepherd.initials} size="sm" />
        <div className="min-w-0">
          <div className="font-medium truncate">{shepherd.fullName}</div>
          <div className="text-xs text-muted">
            {assignments.length === 0
              ? "No assignments yet"
              : `${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`}
          </div>
        </div>
      </div>

      {assignments.length > 0 && (
        <ul className="space-y-1.5 mb-3">
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
              {isAdmin && (
                <form action={removeAssignmentAction} className="ml-auto">
                  <input type="hidden" name="id" value={a.id} />
                  <button
                    type="submit"
                    className="text-xs text-muted hover:text-warn-soft-fg cursor-pointer"
                    title="Remove this assignment"
                  >
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <AddAssignmentForm
          shepherdPersonId={shepherd.personId}
          shepherdName={shepherd.fullName}
          targetsByKind={targetsByKind}
          excludePersonIds={[shepherd.personId]}
        />
      )}
    </Card>
  );
}
