import Link from "next/link";
import { Avatar, Card, CardHeader, Pill, Stat } from "@/components/ui";
import { listPersonCheckins } from "@/lib/checkins-read";
import { explainClassification } from "@/lib/classify-explain";
import { listGroupsAttendedByPerson } from "@/lib/community-lane";
import { listTeamMembershipsByPerson } from "@/lib/serve-lane";
import {
  type PersonRef,
  getShepherdees,
  getShepherds,
} from "@/lib/shepherd-graph";
import { listPersonFormSubmissions } from "@/lib/people-read";

// ─── Skeletons ────────────────────────────────────────────────────────
// Rendered instantly as Suspense fallbacks so the page shell never
// blocks on a query. Each mirrors the rough height of its real card so
// the layout doesn't jump when data streams in.

export function SectionSkeleton({
  title,
  lines = 3,
}: {
  title: string;
  lines?: number;
}) {
  return (
    <Card className="p-5 animate-pulse">
      <div className="h-3.5 w-40 bg-bg-elev-2 rounded mb-4" />
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="h-3 bg-bg-elev-2/60 rounded"
            style={{ width: `${90 - i * 12}%` }}
          />
        ))}
      </div>
      <span className="sr-only">Loading {title}…</span>
    </Card>
  );
}

export function ShepherdingOverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="rounded-[10px] border border-border-soft bg-bg-elev p-4 animate-pulse"
          >
            <div className="h-2.5 w-20 bg-bg-elev-2 rounded mb-3" />
            <div className="h-6 w-12 bg-bg-elev-2/70 rounded" />
          </div>
        ))}
      </div>
      <SectionSkeleton title="shepherding" lines={4} />
    </div>
  );
}

// ─── Shepherding overview ─────────────────────────────────────────────

function FlockCard({ person, sub }: { person: PersonRef; sub?: string }) {
  return (
    <Link
      href={`/people/${person.personId}`}
      className="flex items-center gap-2.5 rounded-lg border border-border-soft p-2.5 hover:border-accent transition-colors"
    >
      <Avatar initials={person.initials} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{person.fullName}</div>
        {sub && <div className="text-xs text-muted truncate">{sub}</div>}
      </div>
      {person.isMinor && <Pill tone="muted">kid</Pill>}
    </Link>
  );
}

function FlockGrid({
  cards,
}: {
  cards: Array<{ person: PersonRef; sub?: string }>;
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {cards.slice(0, 60).map((c) => (
          <FlockCard key={c.person.personId} person={c.person} sub={c.sub} />
        ))}
      </div>
      {cards.length > 60 && (
        <div className="text-xs text-muted mt-2">
          + {(cards.length - 60).toLocaleString()} more
        </div>
      )}
    </>
  );
}

/** "with Sarah Chen, Marcus Johnson +2" — the other shepherds on a
 *  co-shepherded person. */
function withLabel(names: string[]): string {
  if (names.length <= 2) return `with ${names.join(", ")}`;
  return `with ${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/** Three ordered sections: who shepherds this person, then the people
 *  they shepherd exclusively, then the people they co-shepherd with
 *  others. Streams in after the page shell. */
export async function ShepherdingOverview({
  orgId,
  slug,
  firstName,
}: {
  orgId: number;
  slug: string;
  firstName: string;
}) {
  const shepherdees = getShepherdees(orgId, slug);
  const shepherds = getShepherds(orgId, slug);

  // Upward — who shepherds this person, grouped by shepherd.
  const shepherdsByPerson = new Map<
    string,
    { name: string; initials: string; vias: string[] }
  >();
  for (const link of shepherds) {
    const entry = shepherdsByPerson.get(link.shepherd.personId) ?? {
      name: link.shepherd.fullName,
      initials: link.shepherd.initials,
      vias: [],
    };
    entry.vias.push(link.via);
    shepherdsByPerson.set(link.shepherd.personId, entry);
  }

  // Downward — flatten the flock to distinct people, tracking the
  // context(s) through which this person reaches them.
  const flock = new Map<string, { ref: PersonRef; vias: Set<string> }>();
  for (const g of shepherdees) {
    for (const p of g.people) {
      const e = flock.get(p.personId) ?? { ref: p, vias: new Set<string>() };
      e.vias.add(g.via);
      flock.set(p.personId, e);
    }
  }

  // Split: exclusive (no other shepherd reaches them) vs co-shepherded.
  const exclusive: Array<{ person: PersonRef; sub?: string }> = [];
  const coShepherded: Array<{ person: PersonRef; sub?: string }> = [];
  for (const [pid, e] of flock) {
    const others = new Map<string, string>();
    for (const link of getShepherds(orgId, pid)) {
      if (link.shepherd.personId === slug) continue;
      others.set(link.shepherd.personId, link.shepherd.fullName);
    }
    if (others.size === 0) {
      exclusive.push({ person: e.ref, sub: [...e.vias].join(" · ") });
    } else {
      coShepherded.push({
        person: e.ref,
        sub: withLabel([...others.values()]),
      });
    }
  }
  exclusive.sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));
  coShepherded.sort((a, b) =>
    a.person.fullName.localeCompare(b.person.fullName),
  );

  const hasFlock = flock.size > 0;

  return (
    <div className="space-y-4">
      {hasFlock && (
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="Shepherded by"
            value={shepherdsByPerson.size}
            valueTone={shepherdsByPerson.size === 0 ? "warn" : "default"}
          />
          <Stat label="Shepherds" value={exclusive.length} valueTone="accent" />
          <Stat label="Co-shepherds" value={coShepherded.length} />
        </div>
      )}

      {/* 1 — Who shepherds this person. */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-1">
          ↑ {firstName} is shepherded by
        </h2>
        {shepherdsByPerson.size === 0 ? (
          <p className="text-xs text-muted">
            No shepherd is connected to {firstName} yet — not through the{" "}
            <Link href="/shepherd-map" className="text-accent hover:underline">
              Shepherd map
            </Link>
            , a group / team leader, or a{" "}
            <Link href="/care-map" className="text-accent hover:underline">
              care roster
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2.5 mt-3">
            {[...shepherdsByPerson.entries()].map(([id, s]) => (
              <li key={id} className="flex items-center gap-3">
                <Avatar initials={s.initials} size="sm" />
                <div className="min-w-0">
                  <Link
                    href={`/people/${id}`}
                    className="font-medium text-sm hover:text-accent"
                  >
                    {s.name}
                  </Link>
                  <div className="text-xs text-muted">{s.vias.join(" · ")}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 2 — People shepherded exclusively by this person. */}
      {exclusive.length > 0 && (
        <Card className="p-5">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-sm font-semibold">
              ↓ People {firstName} shepherds
              <span className="text-muted font-normal">
                {" "}
                · {exclusive.length.toLocaleString()}
              </span>
            </h2>
            <Link
              href="/shepherd-map"
              className="text-xs text-accent hover:underline"
            >
              Shepherd map →
            </Link>
          </div>
          <p className="text-xs text-muted mb-4">
            Exclusively {firstName}&apos;s — no other shepherd is connected to
            these people.
          </p>
          <FlockGrid cards={exclusive} />
        </Card>
      )}

      {/* 3 — People co-shepherded with other shepherds. */}
      {coShepherded.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-1">
            ↓ People {firstName} co-shepherds
            <span className="text-muted font-normal">
              {" "}
              · {coShepherded.length.toLocaleString()}
            </span>
          </h2>
          <p className="text-xs text-muted mb-4">
            Shared with other shepherds — {firstName} is one of several people
            connected to each.
          </p>
          <FlockGrid cards={coShepherded} />
        </Card>
      )}
    </div>
  );
}

// ─── Classification rationale ─────────────────────────────────────────

export async function ClassificationSection({
  orgId,
  slug,
  classification,
  months,
}: {
  orgId: number;
  slug: string;
  classification: string;
  months: number;
}) {
  const rationale = explainClassification(orgId, slug, months);
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold">
          Why &ldquo;{classification}&rdquo;?
        </h2>
        <span className="text-xs text-muted">
          from sync data · {months}mo window
        </span>
      </div>
      {rationale.shepherdedReasons.length === 0 &&
      rationale.blockers.length === 0 &&
      rationale.activitySignals.length === 0 ? (
        <p className="text-xs text-muted italic">
          No shepherding signals at all. Falls back to whatever pco_updated_at
          says.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          {rationale.shepherdedReasons.length > 0 && (
            <div>
              <div className="text-xs font-medium text-good-soft-fg mb-1">
                Pulls them into Shepherded
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-fg">
                {rationale.shepherdedReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {rationale.blockers.length > 0 && (
            <div>
              <div className="text-xs font-medium text-warn-soft-fg mb-1">
                Filtered out of Shepherded
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-muted">
                {rationale.blockers.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {rationale.activitySignals.length > 0 && (
            <div>
              <div
                className={`text-xs font-medium mb-1 ${
                  rationale.isShepherded ? "text-muted" : "text-accent"
                }`}
              >
                {rationale.isShepherded
                  ? "Other activity on record — Shepherded already takes priority"
                  : "Pulls them into Active / Present"}
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-fg">
                {rationale.activitySignals.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[11px] text-subtle pt-2 border-t border-border-softer flex flex-wrap gap-x-4 gap-y-1">
            {rationale.facts.map((f) => (
              <span key={f.label} className="tnum">
                <span className="text-muted">{f.label}:</span> {f.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Form activity ────────────────────────────────────────────────────

export async function FormActivitySection({
  orgId,
  slug,
}: {
  orgId: number;
  slug: string;
}) {
  const submissions = listPersonFormSubmissions(orgId, slug);
  return (
    <Card>
      <CardHeader
        title="Form activity"
        right={
          <span className="text-xs text-muted">{submissions.length} total</span>
        }
      />
      {submissions.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted text-center">
          No form submissions yet.
        </div>
      ) : (
        <ul className="divide-y divide-border-softer">
          {submissions.slice(0, 12).map((s) => (
            <li key={`${s.formId}-${s.pcoId}`} className="px-5 py-3 text-sm">
              <div className="flex items-baseline justify-between mb-0.5">
                <span className="font-medium">
                  {s.formName ?? `Form ${s.formId}`}
                </span>
                {s.verified && (
                  <span className="text-xs text-good-soft-fg">verified</span>
                )}
              </div>
              <div className="text-xs text-muted tnum">
                {s.createdAt
                  ? new Date(s.createdAt).toLocaleDateString()
                  : "—"}
              </div>
            </li>
          ))}
          {submissions.length > 12 && (
            <li className="px-5 py-2.5 text-xs text-muted text-center">
              + {submissions.length - 12} more
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

// ─── Group attendance ─────────────────────────────────────────────────

export async function GroupAttendanceSection({
  orgId,
  slug,
}: {
  orgId: number;
  slug: string;
}) {
  const groupAttendance = listGroupsAttendedByPerson(orgId, slug);
  return (
    <Card>
      <CardHeader
        title="Group attendance"
        right={
          <span className="text-xs text-muted">
            {groupAttendance.length} group
            {groupAttendance.length === 1 ? "" : "s"}
          </span>
        }
      />
      {groupAttendance.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted text-center">
          No group memberships or attendance recorded.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Group</th>
              <th className="text-left font-medium px-5 py-2">Status</th>
              <th className="text-right font-medium px-5 py-2">Attended</th>
              <th className="text-right font-medium px-5 py-2">First</th>
              <th className="text-right font-medium px-5 py-2">Last</th>
            </tr>
          </thead>
          <tbody>
            {groupAttendance.map((g) => {
              const ratio =
                g.totalEventCount > 0
                  ? `${g.attendedCount}/${g.totalEventCount}`
                  : `${g.attendedCount}`;
              let status: { label: string; tone: "good" | "warn" | "muted" } = {
                label: "no data",
                tone: "muted",
              };
              if (g.isCurrentMember)
                status = { label: "current member", tone: "good" };
              else if (g.membershipArchivedAt)
                status = { label: "archived", tone: "warn" };
              else if (g.attendedCount > 0)
                status = { label: "attended, not member", tone: "warn" };
              return (
                <tr
                  key={g.groupId}
                  className="border-b border-border-softer hover:bg-bg-elev-2/60"
                >
                  <td className="px-5 py-2.5">
                    <div className="font-medium truncate">
                      {g.groupName ?? `(unnamed #${g.groupId})`}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {g.groupTypeName ?? "—"}
                    </div>
                  </td>
                  <td className="px-5 py-2.5">
                    <Pill tone={status.tone}>{status.label}</Pill>
                  </td>
                  <td className="px-5 py-2.5 text-right tnum">{ratio}</td>
                  <td className="px-5 py-2.5 text-right tnum text-muted">
                    {g.firstAttendedAt
                      ? new Date(g.firstAttendedAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right tnum text-muted">
                    {g.lastAttendedAt
                      ? new Date(g.lastAttendedAt).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ─── Team attendance ──────────────────────────────────────────────────

export async function TeamAttendanceSection({
  orgId,
  slug,
  months,
}: {
  orgId: number;
  slug: string;
  months: number;
}) {
  const teamRows = listTeamMembershipsByPerson(orgId, slug, months);
  return (
    <Card>
      <CardHeader
        title="Team attendance"
        right={
          <span className="text-xs text-muted">
            {teamRows.length} team{teamRows.length === 1 ? "" : "s"} · window{" "}
            {months}mo
          </span>
        }
      />
      {teamRows.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted text-center">
          No team rosters on file for this person.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Team</th>
              <th className="text-left font-medium px-5 py-2">Role</th>
              <th
                className="text-right font-medium px-5 py-2"
                title="Distinct plans they served in the window vs. plans they were scheduled on"
              >
                Served
              </th>
              <th className="text-right font-medium px-5 py-2">Last served</th>
            </tr>
          </thead>
          <tbody>
            {teamRows.map((t) => (
              <tr
                key={t.teamId}
                className="border-b border-border-softer hover:bg-bg-elev-2/60"
              >
                <td className="px-5 py-2.5">
                  <div className="font-medium truncate">
                    {t.teamName ?? `(unnamed #${t.teamId})`}
                  </div>
                  <div className="text-xs text-muted truncate">
                    {t.serviceTypeName ?? "—"}
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  <Pill tone={t.isLeader ? "accent" : "muted"}>
                    {t.isLeader ? "leader" : "member"}
                  </Pill>
                </td>
                <td className="px-5 py-2.5 text-right tnum">
                  {t.scheduledInWindow > 0
                    ? `${t.servedInWindow}/${t.scheduledInWindow}`
                    : t.servedInWindow > 0
                      ? `${t.servedInWindow}`
                      : "—"}
                </td>
                <td className="px-5 py-2.5 text-right tnum text-muted">
                  {t.lastServedAt
                    ? new Date(t.lastServedAt).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ─── Check-ins ────────────────────────────────────────────────────────

export async function CheckinsSection({
  orgId,
  slug,
}: {
  orgId: number;
  slug: string;
}) {
  const checkins = listPersonCheckins(orgId, slug);
  return (
    <Card>
      <CardHeader
        title="Check-ins"
        right={
          <span className="text-xs text-muted">
            {checkins.totalAsCheckin.toLocaleString()} as check-in ·{" "}
            {checkins.totalAsChecker.toLocaleString()} as the one checking-in ·
            window {checkins.windowMonths}mo
          </span>
        }
      />
      {checkins.rows.length === 0 ? (
        <div className="px-5 py-8 text-sm text-muted text-center">
          No check-in records for this person.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border-soft">
              <th className="text-left font-medium px-5 py-2">Event</th>
              <th className="text-right font-medium px-5 py-2">All-time</th>
              <th
                className="text-right font-medium px-5 py-2"
                title={`Check-ins in the last ${checkins.windowMonths} months`}
              >
                In window
              </th>
              <th
                className="text-right font-medium px-5 py-2"
                title="Check-ins where someone else (a parent / leader) did the check-in — the dependent signal."
              >
                By other
              </th>
              <th className="text-right font-medium px-5 py-2">Last</th>
            </tr>
          </thead>
          <tbody>
            {checkins.rows.map((r) => (
              <tr
                key={r.eventId}
                className={`border-b border-border-softer hover:bg-bg-elev-2/60 ${
                  r.eventArchived ? "opacity-60" : ""
                }`}
              >
                <td className="px-5 py-2.5">
                  <div className="font-medium truncate">
                    {r.eventName ?? `(unnamed #${r.eventId})`}
                    {r.shepherdedEvent && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-soft-bg text-accent">
                        shepherded
                      </span>
                    )}
                    {r.eventArchived && (
                      <span className="ml-2 text-xs text-muted font-normal">
                        archived
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-2.5 text-right tnum">
                  {r.total.toLocaleString()}
                </td>
                <td className="px-5 py-2.5 text-right tnum">
                  {r.inWindow.toLocaleString()}
                </td>
                <td className="px-5 py-2.5 text-right tnum text-muted">
                  {r.byOther.toLocaleString()}
                </td>
                <td className="px-5 py-2.5 text-right tnum text-muted">
                  {r.lastAt ? new Date(r.lastAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
