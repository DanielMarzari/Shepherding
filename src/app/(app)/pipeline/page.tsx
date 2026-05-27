import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { getSyncSettings } from "@/lib/pco";
import {
  GroupPipelineSection,
  PipelineSectionSkeleton,
  ServingPipelineSection,
} from "./sections";

export default async function PipelinePage() {
  const session = await requireOrg();
  const settings = getSyncSettings(session.orgId);
  return (
    <AppShell active="See more" breadcrumb="See more › Pipeline">
      <div className="px-5 md:px-7 py-7 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            How long does it take someone to go from interest to action?
            Two flows: a serving-interest form to a person&apos;s first
            scheduled serve, and a group application to that person&apos;s
            first attended event in that group. The historical chart
            cohorts by the month the interest event landed in, so you can
            see when you&apos;re on top of follow-up and when things are
            slipping.
          </p>
        </div>

        <Suspense
          fallback={<PipelineSectionSkeleton title="serving pipeline" />}
        >
          <ServingPipelineSection
            orgId={session.orgId}
            formId={settings.servingInterestFormId}
          />
        </Suspense>

        <Suspense
          fallback={<PipelineSectionSkeleton title="group pipeline" />}
        >
          <GroupPipelineSection orgId={session.orgId} />
        </Suspense>
      </div>
    </AppShell>
  );
}
