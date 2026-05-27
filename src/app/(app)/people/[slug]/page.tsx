import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/BackLink";
import { Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import {
  type ActivityClassification,
  getPersonByPcoId,
} from "@/lib/people-read";
import {
  CheckinsSection,
  ClassificationSection,
  FormActivitySection,
  GroupAttendanceSection,
  SectionSkeleton,
  ShepherdingOverview,
  ShepherdingOverviewSkeleton,
  TeamAttendanceSection,
} from "./sections";
import { PersonTimeline, PersonTimelineSkeleton } from "./timeline";

const TONE: Record<ActivityClassification, "good" | "accent" | "warn" | "muted"> = {
  active: "good",
  shepherded: "accent",
  present: "accent",
  inactive: "warn",
};

/** The page itself does ONE query — getPersonByPcoId — so the shell
 *  (header + personal details) paints almost immediately. Every heavier
 *  section streams in behind its own <Suspense> boundary, so clicking a
 *  name no longer blocks on 7 sequential queries. */
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

  const orgId = session.orgId;
  const age = person.birthdate ? computeAge(person.birthdate) : null;
  const firstName = person.firstName ?? person.fullName;

  return (
    <AppShell active="People" breadcrumb={`People › ${person.fullName}`}>
      <div className="px-5 md:px-7 py-7 max-w-7xl space-y-6">
        <div>
          <BackLink fallback="/people">← Back</BackLink>
        </div>

        {/* Header — paints instantly from the single person query. */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full grid place-items-center text-lg font-semibold text-white bg-gradient-to-br from-violet-500 to-pink-500 shrink-0">
              {person.initials}
            </div>
            <div>
              <div className="text-muted text-xs mb-0.5">
                PCO #{person.pcoId}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {person.fullName}
              </h1>
              <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
                <Pill tone={TONE[person.classification]}>
                  {person.classification}
                </Pill>
                {person.membershipType && (
                  <span className="text-muted">{person.membershipType}</span>
                )}
                {person.gender && (
                  <span className="text-muted">· {person.gender}</span>
                )}
                {age !== null && (
                  <span className="text-muted">· age {age}</span>
                )}
                {person.maritalStatus && (
                  <span className="text-muted">· {person.maritalStatus}</span>
                )}
              </div>
            </div>
          </div>
          <a
            href={`https://people.planningcenteronline.com/people/${person.pcoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 rounded border border-border-soft text-xs text-muted hover:text-fg"
          >
            Open in PCO ↗
          </a>
        </div>

        {/* Main content + right-side activity timeline. On narrow
            screens the timeline drops below the main content. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
          <div className="space-y-6 min-w-0">
            {/* Shepherding overview — flock, stat strip, who-shepherds. */}
            <Suspense fallback={<ShepherdingOverviewSkeleton />}>
              <ShepherdingOverview orgId={orgId} slug={slug} firstName={firstName} />
            </Suspense>

            {/* Why this classification? */}
            <Suspense fallback={<SectionSkeleton title="classification" lines={4} />}>
              <ClassificationSection
                orgId={orgId}
                slug={slug}
                classification={person.classification}
                months={settings.activityMonths}
              />
            </Suspense>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
              <Card className="p-5 xl:col-span-2">
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
                  <Row label="In PCO since" value={fmtDate(person.pcoCreatedAt)} />
                  <Row
                    label="PCO record updated"
                    value={fmtDate(person.pcoUpdatedAt)}
                  />
                  <Row
                    label="Last form submission"
                    value={fmtDate(person.lastFormSubmissionAt)}
                  />
                </dl>
                <p className="mt-5 pt-4 border-t border-border-soft text-xs text-muted">
                  Name, birthdate, and address are stored encrypted at rest.
                  Decrypted only to render this page.
                </p>
              </Card>

              <Suspense fallback={<SectionSkeleton title="form activity" />}>
                <FormActivitySection orgId={orgId} slug={slug} />
              </Suspense>
            </div>

            <Suspense fallback={<SectionSkeleton title="group attendance" />}>
              <GroupAttendanceSection orgId={orgId} slug={slug} />
            </Suspense>

            <Suspense fallback={<SectionSkeleton title="team attendance" />}>
              <TeamAttendanceSection
                orgId={orgId}
                slug={slug}
                months={settings.activityTrackingMonths}
              />
            </Suspense>

            <Suspense fallback={<SectionSkeleton title="check-ins" />}>
              <CheckinsSection orgId={orgId} slug={slug} />
            </Suspense>
          </div>

          <aside className="lg:sticky lg:top-4">
            <Suspense fallback={<PersonTimelineSkeleton />}>
              <PersonTimeline orgId={orgId} slug={slug} />
            </Suspense>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-softer last:border-0">
      <dt className="text-muted text-xs uppercase tracking-wider w-44 shrink-0">
        {label}
      </dt>
      <dd className="text-fg flex-1 text-right">
        {value ? value : <span className="text-subtle">—</span>}
      </dd>
    </div>
  );
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? null : d.toLocaleDateString();
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
