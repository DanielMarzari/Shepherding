import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackLink } from "@/components/BackLink";
import { Card, CardHeader } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import { getServingPipelineDetail } from "@/lib/pipeline-read";
import { DetailHeader, DetailTable } from "../../detail-shared";

export default async function ServingPipelineDetailPage({
  params,
}: {
  params: Promise<{ serviceTypeId: string }>;
}) {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  const { serviceTypeId } = await params;
  const data = getServingPipelineDetail(
    session.orgId,
    settings.servingInterestFormId,
    decodeURIComponent(serviceTypeId),
  );
  if (!data.people.length && data.serviceTypeName === "(unknown service type)") {
    notFound();
  }

  return (
    <AppShell
      active="See more"
      breadcrumb={`See more › Pipeline › ${data.serviceTypeName}`}
    >
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-7xl">
        <div>
          <BackLink fallback="/pipeline">← Back to pipeline</BackLink>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.serviceTypeName}
          </h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Everyone who converted in this service type — sorted slowest
            first so the long tail is visible. Trigger is{" "}
            {data.formConfigured ? (
              <>
                a submission of{" "}
                <span className="text-fg font-medium">{data.formName}</span>
              </>
            ) : (
              <em>any form submission</em>
            )}
            ; conversion is the person&apos;s first time scheduled on a
            plan for this service type.
          </p>
        </div>

        <Card className="p-5 space-y-5">
          <DetailHeader stats={data.stats} />
          <DetailTable
            people={data.people}
            startLabel="Form submitted"
            endLabel="First scheduled"
          />
        </Card>

        <p className="text-xs text-muted">
          Click any name to open their profile.{" "}
          <Link href="/pipeline" className="text-accent hover:underline">
            Back to all pipelines
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
