import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill, Stat } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listShepherds } from "@/lib/assignments-read";
import {
  type CareRosterPerson,
  countActiveNotShepherded,
  listCareAssignments,
  listCareCandidates,
} from "@/lib/care-read";
import { getSyncSettings } from "@/lib/pco";
import { getClassificationCounts } from "@/lib/people-read";
import { listKnownMarksByPerson } from "@/lib/shepherd-intake";
import { CareAssignPanel } from "./CareAssignPanel";
import { removeCareAssignmentAction } from "./actions";

interface SearchParams {
  scope?: string;
}

export default async function CareMapPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const includePresent = params.scope === "present";
  const isAdmin = session.role === "admin";

  const shepherds = listShepherds(session.orgId);
  const candidates = listCareCandidates(session.orgId, includePresent);
  const rosters = listCareAssignments(session.orgId);

  const assignedCount = Array.from(rosters.values()).reduce(
    (n, arr) => n + arr.length,
    0,
  );

  // Reconciliation against the /people "Active" count. Care candidates
  // = active ADULTS not already on a roster. /people's Active headline
  // is also adults-only (kids shown separately), and both now use the
  // identical shepherded definition, so the only gap is people already
  // on a roster. Surface the math so the number isn't a mystery.
  const settings = getSyncSettings(session.orgId);
  const counts = getClassificationCounts(
    session.orgId,
    settings.activityMonths,
  );
  const activeAdults = counts.active - counts.activeKids;

  // "I know them" marks from the public /know intake page, keyed by
  // person → shepherd names. Surfaced on the assign panel so the admin
  // can prioritize the relationships shepherds have already flagged.
  const knownMarks = listKnownMarksByPerson(session.orgId);
  const knownBy: Record<string, string[]> = {};
  for (const [personId, marks] of knownMarks) {
    knownBy[personId] = marks.map((m) => m.shepherdName);
  }
  const knownMarkCount = knownMarks.size;

  // Even-split estimate: if the whole Active category were divided
  // across the shepherd team, how many people would each carry?
  const activeTotal = countActiveNotShepherded(session.orgId);
  const perShepherd =
    shepherds.length > 0 ? Math.ceil(activeTotal / shepherds.length) : null;

  return (
    <AppShell active="Care map" breadcrumb="Data Mappings › Care map">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Care map</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Make sure no active person slips through the cracks. Assign people
            who aren&apos;t already shepherded to a member of the shepherd team
            for a regular touch point — prayer, a card, a check-in. When
            someone becomes shepherded (joins a group or team) they drop off
            the care roster automatically.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label={`Unassigned (${includePresent ? "active + present" : "active"})`}
            value={candidates.length.toLocaleString()}
            valueTone={candidates.length > 0 ? "warn" : "good"}
            delta={
              assignedCount > 0
                ? `${activeAdults.toLocaleString()} active adults − ${assignedCount.toLocaleString()} assigned`
                : `${activeAdults.toLocaleString()} active adults, none assigned yet`
            }
          />
          <Stat label="On a care roster" value={assignedCount.toLocaleString()} />
          <Stat label="Shepherd team" value={shepherds.length.toLocaleString()} />
          <Stat
            label="Even split per shepherd"
            value={perShepherd === null ? "—" : `≈ ${perShepherd.toLocaleString()}`}
            delta={
              perShepherd === null
                ? "no one on the shepherd team yet"
                : `to cover all ${activeTotal.toLocaleString()} active people`
            }
            highlight
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-subtle uppercase tracking-wider text-[10px] mr-1">
            Scope
          </span>
          <ScopeChip label="Active only" href="/care-map" active={!includePresent} />
          <ScopeChip
            label="Active + Present"
            href="/care-map?scope=present"
            active={includePresent}
          />
        </div>

        {isAdmin && (
          <Card className="p-4 text-xs flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-muted">
              Shepherds can flag who they personally know at{" "}
              <span className="font-mono text-fg">/know</span> (public,
              email sign-in).{" "}
              {knownMarkCount > 0 ? (
                <span className="text-accent">
                  {knownMarkCount.toLocaleString()}{" "}
                  {knownMarkCount === 1 ? "person has" : "people have"} been
                  flagged — they sort to the top with a “known by” tag.
                </span>
              ) : (
                "No one's been flagged yet."
              )}
            </span>
            <Link
              href="/know"
              target="_blank"
              className="text-accent hover:underline shrink-0"
            >
              Open intake page ↗
            </Link>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-1">Assign people</h2>
          <p className="text-xs text-muted mb-4">
            {includePresent
              ? "Active and present people"
              : "Active people"}{" "}
            with no carer yet. Tick names, pick a shepherd, assign.
          </p>
          {isAdmin ? (
            <CareAssignPanel
              candidates={candidates}
              shepherds={shepherds.map((s) => ({
                personId: s.personId,
                fullName: s.fullName,
              }))}
              knownBy={knownBy}
            />
          ) : (
            <p className="text-sm text-muted">
              {candidates.length.toLocaleString()} people need a carer.
              Assigning is admin-only.
            </p>
          )}
        </Card>

        <div>
          <h2 className="text-sm font-semibold mb-3">Care rosters</h2>
          {shepherds.length === 0 ? (
            <Card className="p-6 text-sm text-muted">
              No one is on the{" "}
              <span className="text-fg">REFERENCE - Shepherd Team</span> PCO
              list yet. Add people to that list in PCO and re-sync.
            </Card>
          ) : (
            <div className="space-y-3">
              {shepherds.map((s) => (
                <RosterCard
                  key={s.personId}
                  name={s.fullName}
                  initials={s.initials}
                  roster={rosters.get(s.personId) ?? []}
                  isAdmin={isAdmin}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function ScopeChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-bg-elev-2 border-accent text-fg"
          : "border-border-soft text-muted hover:border-accent hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
}

function RosterCard({
  name,
  initials,
  roster,
  isAdmin,
}: {
  name: string;
  initials: string;
  roster: CareRosterPerson[];
  isAdmin: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-3">
        <Avatar initials={initials} size="sm" />
        <div className="min-w-0">
          <div className="font-medium truncate">{name}</div>
          <div className="text-xs text-muted">
            {roster.length === 0
              ? "No one assigned yet"
              : `Caring for ${roster.length} ${roster.length === 1 ? "person" : "people"}`}
          </div>
        </div>
      </div>

      {roster.length > 0 && (
        <ul className="space-y-1.5">
          {roster.map((p) => (
            <li key={p.assignmentId} className="flex items-center gap-2 text-sm">
              <Link
                href={`/people/${p.personId}`}
                className="hover:text-accent truncate"
              >
                {p.fullName}
              </Link>
              {p.isMinor && <Pill tone="warn">kid</Pill>}
              {p.note && (
                <span className="text-xs text-muted italic truncate">
                  — {p.note}
                </span>
              )}
              {isAdmin && (
                <form action={removeCareAssignmentAction} className="ml-auto">
                  <input type="hidden" name="id" value={p.assignmentId} />
                  <button
                    type="submit"
                    className="text-xs text-muted hover:text-warn-soft-fg cursor-pointer"
                    title="Remove from this roster"
                  >
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
