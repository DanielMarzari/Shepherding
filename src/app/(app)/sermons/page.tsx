import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { listSermons, SERMON_STEPS } from "@/lib/sermon-impact";
import { SermonFilter } from "./sermon-filter";

export const dynamic = "force-dynamic";

export default async function SermonsPage() {
  const session = await requireOrg();
  const sermons = listSermons(session.orgId);

  return (
    <AppShell active="Sermons" breadcrumb="Next steps › Sermons">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sermons</h1>
            <p className="text-muted text-sm mt-1 max-w-3xl">
              Every sermon we have a transcript for, with the next steps it called people toward. Open one to
              read the full transcript with each call highlighted exactly where it was said.
            </p>
          </div>
          <div className="text-right text-xs text-muted">
            <div className="text-fg font-medium">{sermons.length} sermons</div>
            {sermons.length > 0 && (
              <div>
                {sermons[sermons.length - 1].preachedOn} – {sermons[0].preachedOn}
              </div>
            )}
          </div>
        </div>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">What the tags mean</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2">
            {SERMON_STEPS.map((s) => (
              <div key={s.key} className="text-xs">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted"> — {s.what}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-3 leading-relaxed">
            Only specific, measurable next steps are tagged. Abstract calls (follow Jesus, read Scripture,
            invite someone, care for others) are deliberately excluded — there&rsquo;s no way to measure a
            response to them.
          </p>
        </Card>

        <SermonFilter sermons={sermons} />
      </div>
    </AppShell>
  );
}
