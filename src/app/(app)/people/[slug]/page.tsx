import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listGroupsAttendedByPerson } from "@/lib/community-lane";
import { getSyncSettings } from "@/lib/pco";
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

  const age = person.birthdate ? computeAge(person.birthdate) : null;

  return (
    <AppShell active="People" breadcrumb={`People › ${person.fullName}`}>
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-5xl">
        <div>
          <Link href="/people" className="text-xs text-muted hover:text-fg">
            ← All people
          </Link>
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

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-2">Coming next</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
            <li>Sunday check-in / attendance history.</li>
            <li>Pastoral notes and touchpoints.</li>
            <li>Lane journey and movement timeline.</li>
          </ul>
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
