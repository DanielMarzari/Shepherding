import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { computeSermonImpact, type CategoryStat } from "@/lib/sermon-impact";

export const dynamic = "force-dynamic";

function fmtPct(x: number | null | undefined): string {
  if (x == null) return "—";
  const v = Math.round(x * 100);
  return (v > 0 ? "+" : "") + v + "%";
}
function fmtDate(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function StepCard({ c }: { c: CategoryStat }) {
  if (!c.measurable) {
    return (
      <Card className="p-4 space-y-1.5 border-border-soft">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{c.name}</span>
          <Pill tone="muted">not scoreable</Pill>
        </div>
        <p className="text-xs text-muted leading-relaxed">{c.what}</p>
        <p className="text-xs">
          Preached on <span className="font-medium">{c.nCalled}</span> Sundays (
          {Math.round(c.callShare * 100)}%).
        </p>
        <p className="text-xs text-warn-soft-fg leading-relaxed">{c.gap}</p>
      </Card>
    );
  }
  const pts = c.contrast == null ? null : Math.round(c.contrast * 100);
  const dir = pts == null ? "flat" : pts >= 4 ? "up" : pts <= -4 ? "down" : "flat";
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{c.name}</span>
        <Pill tone="accent">→ {c.metricLabel}</Pill>
      </div>
      <p className="text-xs text-muted leading-relaxed">{c.what}</p>
      <div className="flex items-end gap-2">
        <span
          className={`text-2xl font-semibold tabular-nums ${
            dir === "up" ? "text-good-soft-fg" : dir === "down" ? "text-warn-soft-fg" : "text-fg"
          }`}
        >
          {pts == null ? "—" : (pts > 0 ? "+" : "") + pts + " pts"}
        </span>
        <span className="text-xs text-muted mb-1">vs Sundays without it</span>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        After: median <span className="font-medium text-fg">{fmtPct(c.upliftCalled)}</span> (n={c.nCalled});
        without: {fmtPct(c.upliftControl)} (n={c.nControl}).
      </p>
    </Card>
  );
}

export default async function SermonImpactPage() {
  const session = await requireOrg();
  const data = computeSermonImpact(session.orgId);
  const scoreable = data.categories.filter((c) => c.measurable);
  const blocked = data.categories.filter((c) => !c.measurable);

  return (
    <AppShell active="Sermon impact" breadcrumb="Next steps › Sermon impact">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sermon impact</h1>
            <p className="text-muted text-sm mt-1 max-w-3xl">
              Only the <em>specific, measurable</em> next steps a sermon called for — give, join a group,
              serve, get baptized, become a member, come to a prayer gathering — against congregation activity
              in the 5 weeks after.{" "}
              <Link href="/sermons" className="text-accent-soft-fg hover:underline">
                Browse all sermons →
              </Link>
            </p>
          </div>
          <div className="text-right text-xs text-muted">
            <div className="text-fg font-medium">{data.classifiedSermons} sermons</div>
            <div>
              {data.earliest ? fmtDate(data.earliest) : "—"} – {data.latest ? fmtDate(data.latest) : "—"}
            </div>
          </div>
        </div>

        <section>
          <h2 className="text-sm font-semibold mb-2">What we found</h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.insights.map((ins, i) => (
              <li key={i} className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      ins.tone === "up" ? "bg-good-soft-fg" : ins.tone === "down" ? "bg-warn-soft-fg" : "bg-muted"
                    }`}
                  />
                  <span className="text-sm font-medium">{ins.title}</span>
                </div>
                <p className="text-xs text-muted mt-1 leading-relaxed">{ins.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Next steps we can score</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {scoreable.map((c) => (
              <StepCard key={c.key} c={c} />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Preached, but not scoreable yet</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {blocked.map((c) => (
              <StepCard key={c.key} c={c} />
            ))}
          </div>
        </section>

        <p className="text-xs text-muted leading-relaxed max-w-3xl">
          Uplift compares the 5 weeks after a sermon to the local seasonal norm (median weekly level in the
          surrounding ~6 months). These are congregation-level correlations, not causation — campaigns,
          launches, and holidays move the same numbers. Abstract calls (follow Jesus, read Scripture, invite
          someone, care for others) are deliberately not tracked: there&rsquo;s no way to measure a response.
        </p>
      </div>
    </AppShell>
  );
}
