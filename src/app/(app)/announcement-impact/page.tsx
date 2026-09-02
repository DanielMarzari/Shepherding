import { AppShell } from "@/components/AppShell";
import { Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  computeAnnouncementImpact,
  type AnnCategoryStat,
  type AnnWeekRow,
} from "@/lib/announcement-impact";
import { NEXT_STEPS, type MetricKey } from "@/lib/sermon-impact";

export const dynamic = "force-dynamic";

function fmtPct(x: number | null | undefined): string {
  if (x == null) return "—";
  const v = Math.round(x * 100);
  return (v > 0 ? "+" : "") + v + "%";
}
function arrow(x: number | null | undefined): string {
  if (x == null) return "";
  if (x > 0.02) return "▲";
  if (x < -0.02) return "▼";
  return "•";
}
function fmtDate(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const RECENT_METRICS: { key: MetricKey; short: string }[] = [
  { key: "group_apps", short: "Group apps" },
  { key: "new_servers", short: "New servers" },
  { key: "new_attenders", short: "New attenders" },
  { key: "checkins", short: "Check-ins" },
];

function ScoreCard({ c }: { c: AnnCategoryStat }) {
  const step = NEXT_STEPS.find((s) => s.key === c.key)!;
  if (!c.measurable) {
    return (
      <Card className="p-4 space-y-1.5 border-border-soft">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{c.label}</span>
          <Pill tone="muted">not tracked</Pill>
        </div>
        <p className="text-xs text-muted leading-relaxed">{step.blurb}</p>
        <p className="text-xs text-muted">
          Announced on <span className="font-medium text-fg">{Math.round(c.announceShare * 100)}%</span> of
          Sundays. No weekly outcome series to correlate against yet.
        </p>
      </Card>
    );
  }
  const contrastPts = c.contrast == null ? null : Math.round(c.contrast * 100);
  const dir = contrastPts == null ? "muted" : contrastPts >= 4 ? "up" : contrastPts <= -4 ? "down" : "flat";
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{c.label}</span>
        <Pill tone="accent">→ {c.metricLabel}</Pill>
      </div>
      <div className="flex items-end gap-2">
        <span
          className={`text-2xl font-semibold tabular-nums ${
            dir === "up" ? "text-good-soft-fg" : dir === "down" ? "text-warn-soft-fg" : "text-fg"
          }`}
        >
          {contrastPts == null ? "—" : (contrastPts > 0 ? "+" : "") + contrastPts + " pts"}
        </span>
        <span className="text-xs text-muted mb-1">vs Sundays without it</span>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        After announcing, {c.metricLabel} ran a median{" "}
        <span className="font-medium text-fg">{fmtPct(c.upliftAnnounced)}</span> vs the local norm (n=
        {c.nAnnounced}). Without: {fmtPct(c.upliftControl)} (n={c.nControl}).
      </p>
    </Card>
  );
}

export default async function AnnouncementImpactPage() {
  const session = await requireOrg();
  const data = computeAnnouncementImpact(session.orgId);
  const measurable = data.categories.filter((c) => c.measurable);
  const detectable = data.categories.filter((c) => !c.measurable);

  return (
    <AppShell active="Announcement impact" breadcrumb="Next steps › Announcement impact">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Announcement impact</h1>
            <p className="text-muted text-sm mt-1 max-w-3xl">
              What the church promoted from the stage each Sunday — pulled from the worship service order
              (Live &amp; Chapel) — lined up against measurable congregation activity in the 5 weeks after. The
              &ldquo;call&rdquo; here is an actual announcement (giving, a group launch, a serve push, a prayer
              night, a Discover class, a campaign, an invite), so it&rsquo;s usually a sharper next-step signal
              than the sermon topic.
            </p>
          </div>
          {data.weeksWithData > 0 && (
            <div className="text-right text-xs text-muted">
              <div className="text-fg font-medium">{data.weeksWithData} Sundays analyzed</div>
              <div>
                {data.earliest ? fmtDate(data.earliest) : "—"} – {data.latest ? fmtDate(data.latest) : "—"}
              </div>
            </div>
          )}
        </div>

        {data.weeksWithData === 0 ? (
          <Card className="p-8 text-center space-y-2">
            <p className="text-sm font-medium">No service-order data yet</p>
            <p className="text-xs text-muted max-w-md mx-auto leading-relaxed">
              Once the worship service order (plan items) has synced from PCO, this page fills in automatically.
            </p>
          </Card>
        ) : (
          <>
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
              <h2 className="text-sm font-semibold">Next steps we can measure</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {measurable.map((c) => (
                  <ScoreCard key={c.key} c={c} />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Announced, but no outcome to measure yet</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {detectable.map((c) => (
                  <ScoreCard key={c.key} c={c} />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">By Sunday</h2>
              <Card className="p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-border-soft">
                      <th className="font-medium px-4 py-2.5">Sunday</th>
                      <th className="font-medium px-4 py-2.5">Announced (from the service order)</th>
                      {RECENT_METRICS.map((m) => (
                        <th key={m.key} className="font-medium px-3 py-2.5 text-right whitespace-nowrap">
                          {m.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((s: AnnWeekRow) => (
                      <tr key={s.sunday} className="border-b border-border-soft/60 last:border-0 align-top">
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted text-xs">{fmtDate(s.sunday)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {s.categories.length === 0 ? (
                              <span className="text-xs text-muted">—</span>
                            ) : (
                              s.categories.map((call) => (
                                <Pill key={call.key} tone="accent" className="cursor-default">
                                  <span title={call.evidence ?? undefined}>{call.label}</span>
                                </Pill>
                              ))
                            )}
                          </div>
                        </td>
                        {RECENT_METRICS.map((m) => {
                          const v = s.uplift[m.key];
                          return (
                            <td
                              key={m.key}
                              className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${
                                v == null
                                  ? "text-muted"
                                  : v > 0.02
                                    ? "text-good-soft-fg font-medium"
                                    : v < -0.02
                                      ? "text-warn-soft-fg font-medium"
                                      : "text-fg"
                              }`}
                            >
                              {v == null ? "—" : `${arrow(v)} ${fmtPct(v)}`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <p className="text-xs text-muted leading-relaxed max-w-3xl">
                Hover an announcement tag to see the snippet that matched. Uplift = how far the metric ran over
                the 5 weeks after vs the local seasonal norm (median weekly level in the surrounding ~6 months).
                These are congregation-level correlations, not causation — an announcement usually rides along
                with a launch or campaign whose timing does most of the work, and small samples move easily.
                Read them as leads to look into.
              </p>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
