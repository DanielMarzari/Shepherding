import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import {
  computeAnnouncementImpact,
  type StepStat,
  type AnnWeekRow,
} from "@/lib/announcement-impact";

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

function MeasurableCard({ s }: { s: StepStat }) {
  const pts = s.contrast == null ? null : Math.round(s.contrast * 100);
  const dir = pts == null ? "flat" : pts >= 4 ? "up" : pts <= -4 ? "down" : "flat";
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{s.name}</span>
        <Pill tone="accent">→ {s.measureLabel}</Pill>
      </div>
      <p className="text-xs text-muted leading-relaxed">{s.what}</p>
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
        Announced on <span className="font-medium text-fg">{s.announced}</span> Sundays. After: median{" "}
        <span className="font-medium text-fg">{fmtPct(s.upliftAnnounced)}</span> (n={s.nAnnouncedWithData});
        without: {fmtPct(s.upliftControl)} (n={s.nControl}).
      </p>
    </Card>
  );
}

function BlockedCard({ s }: { s: StepStat }) {
  return (
    <Card className="p-4 space-y-1.5 border-border-soft">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{s.name}</span>
        <Pill tone="muted">{s.categoryLabel}</Pill>
      </div>
      <p className="text-xs text-muted leading-relaxed">{s.what}</p>
      <p className="text-xs">
        Announced on <span className="font-medium">{s.announced}</span> Sundays.
      </p>
      <p className="text-xs text-warn-soft-fg leading-relaxed">
        <span className="font-medium">Can&rsquo;t score yet:</span> {s.gap}
      </p>
    </Card>
  );
}

export default async function AnnouncementImpactPage() {
  const session = await requireOrg();
  const data = computeAnnouncementImpact(session.orgId);
  const measurable = data.steps.filter((s) => s.measureLabel && s.announced > 0);
  const blocked = data.steps.filter((s) => !s.measureLabel && s.announced > 0);
  const never = data.steps.filter((s) => s.announced === 0);

  return (
    <AppShell active="Announcement impact" breadcrumb="Next steps › Announcement impact">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Announcement impact</h1>
            <p className="text-muted text-sm mt-1 max-w-3xl">
              Every <em>specific, named</em> next step announced from the stage — pulled from the worship
              service order — and, where we have outcome data, whether anything moved in the 5 weeks after.{" "}
              <Link href="/service-plans" className="text-accent-soft-fg hover:underline">
                Browse the service plans →
              </Link>
            </p>
          </div>
          {data.weeksWithData > 0 && (
            <div className="text-right text-xs text-muted">
              <div className="text-fg font-medium">{data.weeksWithData} Sundays</div>
              <div>
                {data.earliest ? fmtDate(data.earliest) : "—"} – {data.latest ? fmtDate(data.latest) : "—"}
              </div>
            </div>
          )}
        </div>

        {data.weeksWithData === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted">No service-order data has synced yet.</p>
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
              <h2 className="text-sm font-semibold">Next steps we can score</h2>
              <p className="text-xs text-muted">
                These have an outcome series we can compare against.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {measurable.map((s) => (
                  <MeasurableCard key={s.key} s={s} />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">
                Announced, but not scoreable yet ({blocked.length})
              </h2>
              <p className="text-xs text-muted max-w-3xl">
                We know exactly when each of these was announced — but the church doesn&rsquo;t record who
                responded, so there&rsquo;s nothing to measure against. Each card says what would unlock it.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {blocked.map((s) => (
                  <BlockedCard key={s.key} s={s} />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">By Sunday</h2>
              <Card className="p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-border-soft">
                      <th className="font-medium px-4 py-2.5">Sunday</th>
                      <th className="font-medium px-4 py-2.5">Next steps announced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((s: AnnWeekRow) => (
                      <tr key={s.sunday} className="border-b border-border-soft/60 last:border-0 align-top">
                        <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                          {s.planIds[0] ? (
                            <Link
                              href={`/service-plans/${s.planIds[0]}`}
                              className="text-accent-soft-fg hover:underline font-medium"
                            >
                              {fmtDate(s.sunday)}
                            </Link>
                          ) : (
                            <span className="text-muted">{fmtDate(s.sunday)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {s.steps.length === 0 ? (
                              <span className="text-xs text-muted">—</span>
                            ) : (
                              s.steps.map((t) => (
                                <Pill key={t.key} tone="accent">
                                  <span title={t.evidence ?? undefined}>{t.name}</span>
                                </Pill>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              {never.length > 0 && (
                <p className="text-xs text-muted">
                  Never detected in an announcement: {never.map((s) => s.name).join(", ")}.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
