import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/BackLink";
import { Avatar, Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listPersonCheckins } from "@/lib/checkins-read";
import { explainClassification } from "@/lib/classify-explain";
import { listGroupsAttendedByPerson } from "@/lib/community-lane";
import { getSyncSettings } from "@/lib/pco";
import { listTeamMembershipsByPerson } from "@/lib/serve-lane";
import { getShepherdees, getShepherds } from "@/lib/shepherd-graph";
import {
  type ActivityClassification,
  getPersonByPcoId,
  listPersonFormSubmissions,
} from "@/lib/people-read";

const TONE: Record<ActivityClassification, "good" | "accent" | "warn" | "muted"> = {
  active: "good",
  shepherded: "accent",
  present: "accent",
  inactive: "warn",
};

export default async function PersonProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const { slug } = await params;
  const person = getPersonByPcoId(session.orgId, slug, settings.activityMonths);
  if (!person) notFound();
  const submissions = listPersonFormSubmissions(session.orgId, slug);
  const groupAttendance = listGroupsAttendedByPerson(session.orgId, slug);
  const rationale = explainClassification(
    session.orgId,
    slug,
    settings.activityMonths,
  );
  const teamRows = listTeamMembershipsByPerson(
    session.orgId,
    slug,
    settings.activityTrackingMonths,
  );
  const checkins = listPersonCheckins(session.orgId, slug);
  const shepherdees = getShepherdees(session.orgId, slug);
  const shepherds = getShepherds(session.orgId, slug);

  const age = person.birthdate ? computeAge(person.birthdate) : null;
  const firstName = person.firstName ?? person.fullName;

  // Distinct people across every context this person helps shepherd —
  // their effective flock size.
  const flockSize = new Set(
    shepherdees.flatMap((g) => g.people.map((p) => p.personId)),
  ).size;

  // Group "who shepherds them" links by shepherd so the same person
  // overseeing via two contexts shows once with both reasons.
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

  return (
    <AppShell active="People" breadcrumb={`People › ${person.fullName}`}>
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-5xl">
        <div>
          <BackLink fallback="/people">← Back</BackLink>
        </div>

        {/* Header */}
        <div className="flex items-start gap-4 flex-wrap">
          <Avatar initials={person.initials} size="lg" />
          <div className="flex-1 min-w-[240px]">
            <div className="text-muted text-xs mb-0.5">PCO #{person.pcoId}</div>
            <h1 className="text-2xl font-semibold tracking-tight">{person.fullName}</h1>
            <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
              <Pill tone={TONE[person.classification]}>{person.classification}</Pill>
              {person.membershipType && (
                <span className="text-muted">{person.membershipType}</span>
              )}
              {person.gender && <span className="text-muted">· {person.gender}</span>}
              {age !== null && <span className="text-muted">· age {age}</span>}
              {person.maritalStatus && (
                <span className="text-muted">· {person.maritalStatus}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <a
              href={`https://people.planningcenteronline.com/people/${person.pcoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded border border-border-soft text-muted hover:text-fg"
            >
              Open in PCO ↗
            </a>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">PCO record updated</div>
            <div className="font-medium">
              {person.pcoUpdatedAt ? relativeTime(person.pcoUpdatedAt) : "—"}
            </div>
            <div className="text-xs text-muted mt-1 tnum">
              {person.pcoUpdatedAt ? new Date(person.pcoUpdatedAt).toLocaleDateString() : "—"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">In PCO since</div>
            <div className="font-medium">
              {person.pcoCreatedAt ? relativeTime(person.pcoCreatedAt) : "—"}
            </div>
            <div className="text-xs text-muted mt-1 tnum">
              {person.pcoCreatedAt ? new Date(person.pcoCreatedAt).toLocaleDateString() : "—"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Last form submission</div>
            <div className="font-medium">
              {person.lastFormSubmissionAt
                ? relativeTime(person.lastFormSubmissionAt)
                : "—"}
            </div>
            <div className="text-xs text-muted mt-1 tnum">
              {person.lastFormSubmissionAt
                ? new Date(person.lastFormSubmissionAt).toLocaleDateString()
                : "no submissions yet"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Form submissions</div>
            <div className="tnum text-2xl font-semibold">{submissions.length}</div>
            <div className="text-xs text-muted mt-1">across all tracked forms</div>
          </Card>
        </div>

        {/* Classification rationale — explains why this person landed in
            Shepherded / Active / Present / Inactive. */}
        <Card className="p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-semibold">
              Why &ldquo;{person.classification}&rdquo;?
            </h2>
            <span className="text-xs text-muted">
              from sync data · {settings.activityMonths}mo window
            </span>
          </div>
          {rationale.shepherdedReasons.length === 0 &&
          rationale.blockers.length === 0 &&
          rationale.activitySignals.length === 0 ? (
            <p className="text-xs text-muted italic">
              No shepherding signals at all. Falls back to whatever
              pco_updated_at says.
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

        {/* Shepherding relationships — resolved from the Shepherd map
            and care roster. Overseeing a group/service type covers the
            leaders of those groups/teams. */}
        {shepherdees.length > 0 && (
          <Card className="p-5">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-sm font-semibold">
                People {firstName} co-shepherds
                <span className="text-muted font-normal">
                  {" "}
                  · {flockSize.toLocaleString()}
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
              Resolved from the Shepherd map, direct group/team leadership, and
              the care roster. Overseeing a group type covers the leaders of
              those groups. People can have more than one shepherd — this is
              everyone {firstName} helps shepherd.
            </p>
            <div className="space-y-4">
              {shepherdees.map((g, i) => (
                <div key={i}>
                  <div className="text-xs font-medium text-muted mb-1.5">
                    {g.via} ·{" "}
                    <span className="tnum">{g.people.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.people.slice(0, 60).map((p) => (
                      <Link
                        key={p.personId}
                        href={`/people/${p.personId}`}
                        className="px-2 py-1 rounded border border-border-soft text-xs hover:border-accent hover:text-accent transition-colors"
                      >
                        {p.fullName}
                      </Link>
                    ))}
                    {g.people.length > 60 && (
                      <span className="px-2 py-1 text-xs text-muted">
                        + {(g.people.length - 60).toLocaleString()} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-1">
            Who shepherds {firstName}
          </h2>
          {shepherdsByPerson.size === 0 ? (
            <p className="text-xs text-muted">
              No shepherd is connected to {firstName} yet — not through the{" "}
              <Link href="/shepherd-map" className="text-accent hover:underline">
                Shepherd map
              </Link>{" "}
              and not on a{" "}
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
                    <div className="text-xs text-muted">
                      {s.vias.join(" · ")}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <Card className="p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold mb-3">Personal details</h2>
            <dl>
              <Row label="Full name" value={person.fullName} />
              <Row label="PCO ID" value={person.pcoId} />
              <Row label="Membership" value={person.membershipType} />
              <Row label="Status (computed)" value={person.classification} />
              <Row label="Gender" value={person.gender} />
              <Row label="Birthdate" value={person.birthdate} />
              <Row label="Marital status" value={person.maritalStatus} />
              <Row label="Address" value={person.address} />
            </dl>
            <p className="mt-5 pt-4 border-t border-border-soft text-xs text-muted">
              Name, birthdate, and address are stored encrypted at rest. Decrypted only to
              render this page.
            </p>
          </Card>

          <Card>
            <CardHeader
              title="Form activity"
              right={
                <span className="text-xs text-muted">
                  {submissions.length} total
                </span>
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
                      <span className="font-medium">{s.formName ?? `Form ${s.formId}`}</span>
                      {s.verified && (
                        <span className="text-xs text-good-soft-fg">verified</span>
                      )}
                    </div>
                    <div className="text-xs text-muted tnum">
                      {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "—"}
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
        </div>

        <Card>
          <CardHeader
            title="Group attendance"
            right={
              <span className="text-xs text-muted">
                {groupAttendance.length} group{groupAttendance.length === 1 ? "" : "s"}
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
                  if (g.isCurrentMember) status = { label: "current member", tone: "good" };
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

        <Card>
          <CardHeader
            title="Team attendance"
            right={
              <span className="text-xs text-muted">
                {teamRows.length} team{teamRows.length === 1 ? "" : "s"} ·
                window {settings.activityTrackingMonths}mo
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
                  <th className="text-right font-medium px-5 py-2">
                    Last served
                  </th>
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

        <Card>
          <CardHeader
            title="Check-ins"
            right={
              <span className="text-xs text-muted">
                {checkins.totalAsCheckin.toLocaleString()} as check-in ·
                {" "}
                {checkins.totalAsChecker.toLocaleString()} as the one
                checking-in · window {checkins.windowMonths}mo
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
                      {r.lastAt
                        ? new Date(r.lastAt).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-softer last:border-0">
      <dt className="text-muted text-xs uppercase tracking-wider w-44 shrink-0">{label}</dt>
      <dd className="text-fg flex-1 text-right">
        {value ? value : <span className="text-subtle">—</span>}
      </dd>
    </div>
  );
}

function computeAge(birthdate: string): number | null {
  const d = new Date(birthdate);
  if (Number.isNaN(d.valueOf())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.valueOf();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${Math.floor(days)} days ago`;
  const months = days / 30;
  if (months < 12) return `${Math.floor(months)} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
