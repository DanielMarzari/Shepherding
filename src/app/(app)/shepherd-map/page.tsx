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
  listOrgWideAccessIds,
  listShepherds,
  listTargetOptions,
} from "@/lib/assignments-read";
import { AddAssignmentForm } from "./AddAssignmentForm";
import { OrgAccessToggle } from "./OrgAccessToggle";
import { removeAssignmentAction } from "./actions";

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

export default async function ShepherdMapPage() {
  const session = await requireOrg();
  const shepherds = listShepherds(session.orgId);
  const assignments = listAssignments(session.orgId);
  const orgWideAccess = listOrgWideAccessIds(session.orgId);

  const targetsByKind = Object.fromEntries(
    (Object.keys(TARGET_KIND_LABELS) as TargetKind[]).map((k) => [
      k,
      listTargetOptions(session.orgId, k),
    ]),
  ) as Record<TargetKind, TargetOption[]>;

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
          <p className="text-muted text-xs mt-2 max-w-2xl">
            What a shepherd oversees here will also set what they can see
            in the app. The{" "}
            <span className="text-accent">Whole-org access</span> switch on
            each card is the exception — flip it on for people who should
            see the entire organization, not just their ministry areas.
            (Page-by-page scope enforcement is still being built; for now
            this records who the exceptions are.)
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
                orgWide={orgWideAccess.has(s.personId)}
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
  orgWide,
}: {
  shepherd: ShepherdPerson;
  assignments: Assignment[];
  targetsByKind: Record<TargetKind, TargetOption[]>;
  isAdmin: boolean;
  orgWide: boolean;
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
        {isAdmin && (
          <div className="ml-auto shrink-0">
            <OrgAccessToggle
              personId={shepherd.personId}
              initial={orgWide}
            />
          </div>
        )}
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
