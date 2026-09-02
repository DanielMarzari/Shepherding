import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listServicePlans } from "@/lib/announcement-impact";
import { ANNOUNCEMENT_TYPES } from "@/lib/plan-announcements";
import { PlanFilter } from "./plan-filter";

export const dynamic = "force-dynamic";

export default async function ServicePlansPage() {
  const session = await requireOrg();
  const plans = listServicePlans(session.orgId, 800);

  return (
    <AppShell active="Service plans" breadcrumb="Next steps › Service plans">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Service plans</h1>
            <p className="text-muted text-sm mt-1 max-w-3xl">
              Every worship service order we&rsquo;ve pulled from PCO. Open one to see the full order of
              service and exactly which announcement text was matched to which next step — and why.
            </p>
          </div>
          <div className="text-right text-xs text-muted">
            <div className="text-fg font-medium">{plans.length} services</div>
          </div>
        </div>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">What each announcement type means</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
            {ANNOUNCEMENT_TYPES.map((t) => (
              <div key={t.key} className="text-xs">
                <span className="font-medium">{t.label}</span>
                <span className="text-muted"> — {t.what}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-3 leading-relaxed">
            Tags are matched by keyword against the text of the service order (announcement, call-to-worship,
            and closing items — songs and the sermon are skipped). Open a service to see the exact phrase that
            triggered each tag.
          </p>
        </Card>

        <PlanFilter plans={plans} />
      </div>
    </AppShell>
  );
}
