import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireOrg } from "@/lib/auth";
import { AsyncDemographicCharts } from "@/components/AsyncChartSections";
import { DemographicChartsSkeleton } from "@/components/ChartsLoading";
import type { DemographicScope } from "@/lib/demographics";

const SCOPES: Array<{ key: string; label: string; title: string; scope: DemographicScope }> = [
  { key: "all", label: "Everyone", title: "Demographics — everyone on file", scope: { kind: "all" } },
  { key: "engaged", label: "Engaged", title: "Demographics — engaged (shepherded / active / present)", scope: { kind: "engaged" } },
  { key: "groups", label: "In groups", title: "Demographics — people in a group", scope: { kind: "groups" } },
  { key: "teams", label: "On teams", title: "Demographics — people on a team", scope: { kind: "teams" } },
];

export default async function DemographicsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await requireOrg();
  const params = await searchParams;
  const active = SCOPES.find((s) => s.key === params.scope) ?? SCOPES[0];

  return (
    <AppShell active="See more" breadcrumb="See more › Demographics (original design)">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between flex-wrap gap-2">
          <span>Original hand-coded design, kept for comparison during the Page Builder remodel.</span>
          <Link href="/demographics" className="font-medium underline">View the new builder version →</Link>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Membership demographics <span className="text-muted text-base font-normal">· original</span></h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Who makes up the church — membership status, age, gender, and whether
            they have kids — for whichever slice you pick. Drawn from PCO profile
            data; pick a population below.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              href={s.key === "all" ? "/demographics-original" : `/demographics-original?scope=${s.key}`}
              className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                active.key === s.key
                  ? "border-accent bg-bg-elev-2 text-fg"
                  : "border-border-soft text-muted hover:text-fg"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <Suspense
          key={active.key}
          fallback={<DemographicChartsSkeleton title={active.title} />}
        >
          <AsyncDemographicCharts orgId={session.orgId} scope={active.scope} title={active.title} />
        </Suspense>
      </div>
    </AppShell>
  );
}
