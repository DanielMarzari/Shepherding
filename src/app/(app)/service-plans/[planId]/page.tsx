import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getServicePlan } from "@/lib/announcement-impact";
import { findHits, ANNOUNCEMENT_BY_KEY } from "@/lib/plan-announcements";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Render one item's text with every matched announcement phrase highlighted
 *  and labeled with the next step it maps to. */
function HighlightedText({ text }: { text: string }) {
  const hits = findHits(text);
  if (hits.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  hits.forEach((h, i) => {
    if (h.start > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, h.start)}</span>);
    const type = ANNOUNCEMENT_BY_KEY[h.key];
    out.push(
      <mark
        key={`h${i}`}
        className="bg-accent-soft-bg text-accent-soft-fg rounded px-1 underline decoration-2 underline-offset-2 font-medium"
        title={type ? `${type.label} — ${type.what}` : h.key}
      >
        {text.slice(h.start, h.end)}
        <span className="ml-1 text-[0.65rem] uppercase tracking-wide font-semibold opacity-80">
          → {type?.label ?? h.key}
        </span>
      </mark>,
    );
    cursor = h.end;
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
}

export default async function ServicePlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const session = await requireOrg();
  const { planId } = await params;
  const plan = getServicePlan(session.orgId, planId);
  if (!plan) notFound();

  const withText = plan.items.filter((i) => i.text);

  return (
    <AppShell active="Service plans" breadcrumb="Next steps › Service plans › Service">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <Link href="/service-plans" className="text-xs text-accent-soft-fg hover:underline">
            ← All service plans
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">{fmtDate(plan.sortDate)}</h1>
          <p className="text-muted text-sm mt-1">
            {plan.serviceTypeName ?? "—"}
            {plan.title ? ` · ${plan.title}` : ""} · {plan.items.length} items
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Next steps announced this service</h2>
          {plan.types.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-muted">
                No next-step announcements were detected in this service order.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {plan.types.map((t) => (
                <Card key={t.key} className="p-4 space-y-2">
                  <span className="text-sm font-semibold">{t.label}</span>
                  <p className="text-xs text-muted leading-relaxed">{t.what}</p>
                  <div className="space-y-1 pt-1">
                    <p className="text-xs text-muted font-medium">Matched because the plan said:</p>
                    {t.matches.map((m, i) => (
                      <blockquote
                        key={i}
                        className="border-l-2 border-accent-soft-fg/50 pl-3 text-xs italic leading-relaxed"
                      >
                        {m}
                      </blockquote>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Order of service</h2>
          <p className="text-xs text-muted">
            Highlighted phrases are what triggered each tag. Songs, media, and the sermon item are skipped when
            scanning (song notes are vocal arrangements; the sermon has its own page).
          </p>
          <Card className="p-0 divide-y divide-border-soft/60">
            {plan.items.map((item) => (
              <div key={item.pcoId} className="px-4 py-3">
                <div className="flex items-start gap-2 flex-wrap">
                  <Pill tone={item.itemType === "header" ? "accent" : "muted"}>{item.itemType ?? "item"}</Pill>
                  <span
                    className={`text-sm ${item.itemType === "header" ? "font-semibold uppercase tracking-wide" : "font-medium"}`}
                  >
                    {item.title || <span className="text-muted italic">untitled</span>}
                  </span>
                  {!item.scanned && (
                    <span className="text-[0.65rem] text-muted uppercase tracking-wide self-center">
                      not scanned
                    </span>
                  )}
                </div>
                {item.text && (
                  <p className="text-sm text-muted mt-1.5 leading-relaxed whitespace-pre-wrap">
                    {item.scanned ? <HighlightedText text={item.text} /> : item.text}
                  </p>
                )}
              </div>
            ))}
            {withText.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted">
                This service order has no item detail text.
              </div>
            )}
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
