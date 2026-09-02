import { AppShell } from "@/components/AppShell";
import { Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  computeSermonImpact,
  NEXT_STEPS,
  type CategoryStat,
  type SermonDetailRow,
  type MetricKey,
} from "@/lib/sermon-impact";

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

function CategoryScoreCard({ c }: { c: CategoryStat }) {
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
          Called on <span className="font-medium text-fg">{Math.round(c.callShare * 100)}%</span> of Sundays. No
          weekly outcome series exists to correlate against yet.
        </p>
      </Card>
    );
  }
  const contrastPts = c.contrast == null ? null : Math.round(c.contrast * 100);
  const dir =
    contrastPts == null ? "muted" : contrastPts >= 4 ? "up" : contrastPts <= -4 ? "down" : "flat";
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
        <span className="text-xs text-muted mb-1">vs Sundays without the call</span>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        After a strong call, {c.metricLabel} ran a median{" "}
        <span className="font-medium text-fg">{fmtPct(c.avgUpliftCalled)}</span> vs the local norm (n={c.nCalled}).
        Without a call: {fmtPct(c.avgUpliftControl)} (n={c.nControl}).
      </p>
    </Card>
  );
}

export default async function SermonImpactPage() {
  const session = await requireOrg();
  const data = computeSermonImpact(session.orgId);
  const measurable = data.categories.filter((c) => c.measurable);
  const detectable = data.categories.filter((c) => !c.measurable);

  return (
    <AppShell active="Sermon impact" breadcrumb="Sermon impact">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sermon impact</h1>
            <p className="text-muted text-sm mt-1 max-w-3xl">
              What each sermon called people toward — giving, groups, serving, outreach — lined up against
              measurable congregation activity in the 5 weeks after. Sermons and transcripts come from Sermon
              Lab; the outcomes are your PCO data.
            </p>
          </div>
          {data.classifiedSermons > 0 && (
            <div className="text-right text-xs text-muted">
              <div className="text-fg font-medium">{data.classifiedSermons} sermons classified</div>
              <div>
                {data.earliest ? fmtDate(data.earliest) : "—"} – {data.latest ? fmtDate(data.latest) : "—"}
              </div>
            </div>
          )}
        </div>

        {data.classifiedSermons === 0 ? (
          <Card className="p-8 text-center space-y-2">
            <p className="text-sm font-medium">No classified sermons yet</p>
            <p className="text-xs text-muted max-w-md mx-auto leading-relaxed">
              The bridge to Sermon Lab is in place and {data.totalSermons} sermons have been imported, but none
              have been run through the topic / next-step classifier yet. Once classified, this page fills in
              automatically.
            </p>
          </Card>
        ) : (
          <>
            {/* Headline findings */}
            <section>
              <h2 className="text-sm font-semibold mb-2">What we found</h2>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data.insights.map((ins, i) => (
                  <li key={i} className="rounded-lg border border-border-soft bg-bg-elev-2/40 p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          ins.tone === "up"
                            ? "bg-good-soft-fg"
                            : ins.tone === "down"
                              ? "bg-warn-soft-fg"
                              : "bg-muted"
                        }`}
                      />
                      <span className="text-sm font-medium">{ins.title}</span>
                    </div>
                    <p className="text-xs text-muted mt-1 leading-relaxed">{ins.detail}</p>
                  </li>
                ))}
              </ul>
            </section>

            {/* Measurable next-step scoreboard */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Next steps we can measure</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {measurable.map((c) => (
                  <CategoryScoreCard key={c.key} c={c} />
                ))}
              </div>
            </section>

            {/* Detectable-but-not-measurable */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">
                Preached, but no outcome to measure yet
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {detectable.map((c) => (
                  <CategoryScoreCard key={c.key} c={c} />
                ))}
              </div>
            </section>

            {/* Recent sermons */}
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Recent sermons</h2>
              <Card className="p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-border-soft">
                      <th className="font-medium px-4 py-2.5">Date</th>
                      <th className="font-medium px-4 py-2.5">Sermon</th>
                      <th className="font-medium px-4 py-2.5">Called</th>
                      {RECENT_METRICS.map((m) => (
                        <th key={m.key} className="font-medium px-3 py-2.5 text-right whitespace-nowrap">
                          {m.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((s: SermonDetailRow) => (
                      <tr key={s.source_id} className="border-b border-border-soft/60 last:border-0 align-top">
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted text-xs">{fmtDate(s.preached_on)}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium leading-tight">{s.title ?? "Untitled"}</div>
                          {s.topic && <div className="text-xs text-muted">{s.topic}</div>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {s.calls.length === 0 ? (
                              <span className="text-xs text-muted">—</span>
                            ) : (
                              s.calls.map((call) => (
                                <Pill key={call.key} tone={call.intensity >= 2 ? "accent" : "muted"}>
                                  {call.label}
                                  {call.intensity >= 3 ? " ★" : ""}
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
                Uplift = how far the metric ran over the 5 weeks after the sermon vs the{" "}
                <em>local seasonal norm</em> (the median weekly level in the surrounding ~6 months, excluding the
                response window). ★ marks the sermon’s central call. These are congregation-level correlations,
                not causation — seasonality (Christmas, Easter, summer), sermon series, campaigns, and other
                announcements all move the same numbers. Read them as leads to look into, and note where sample
                sizes are small.
              </p>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
