import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Card, Pill } from "@/components/ui";
import { requireOrg } from "@/lib/auth";
import { getSermonDetail, type SermonCall } from "@/lib/sermon-impact";
import { TranscriptView } from "./transcript-view";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

const INTENSITY_WORD: Record<number, string> = {
  0: "not mentioned",
  1: "mentioned in passing",
  2: "a clear ask",
  3: "the central call",
};

export default async function SermonDetailPage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const session = await requireOrg();
  const { sourceId } = await params;
  const sermon = getSermonDetail(session.orgId, Number(sourceId));
  if (!sermon) notFound();

  const called = sermon.calls.filter((c) => c.called);
  const notCalled = sermon.calls.filter((c) => !c.called);

  return (
    <AppShell active="Sermons" breadcrumb="Next steps › Sermons › Sermon">
      <div className="px-5 md:px-7 py-7 space-y-5">
        <div>
          <Link href="/sermons" className="text-xs text-accent-soft-fg hover:underline">
            ← All sermons
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">{sermon.title ?? "Untitled"}</h1>
          <p className="text-muted text-sm mt-1">
            {fmtDate(sermon.preachedOn)}
            {sermon.speaker ? ` · ${sermon.speaker}` : ""}
            {sermon.wordCount ? ` · ${sermon.wordCount.toLocaleString()} words` : ""}
          </p>
        </div>

        {(sermon.topic || sermon.summary || sermon.themes.length > 0) && (
          <Card className="p-4 space-y-2">
            {sermon.topic && (
              <div className="text-sm">
                <span className="text-muted">Topic: </span>
                <span className="font-medium">{sermon.topic}</span>
              </div>
            )}
            {sermon.summary && <p className="text-sm leading-relaxed">{sermon.summary}</p>}
            {sermon.themes.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {sermon.themes.map((t) => (
                  <Pill key={t} tone="muted">
                    {t}
                  </Pill>
                ))}
              </div>
            )}
            {sermon.confidence != null && (
              <p className="text-xs text-muted pt-1">
                Classifier confidence: {Math.round(sermon.confidence * 100)}%
              </p>
            )}
          </Card>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Next steps called in this sermon</h2>
          {called.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-muted">
                No next-step calls were tagged in this sermon — it was teaching without a specific ask.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {called.map((c) => (
                <CallCard key={c.key} c={c} />
              ))}
            </div>
          )}
          {notCalled.length > 0 && (
            <p className="text-xs text-muted pt-1">
              Not called here: {notCalled.map((c) => c.label).join(", ")}.
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Full transcript</h2>
          {sermon.transcript ? (
            <TranscriptView
              transcript={sermon.transcript}
              calls={called.map((c) => ({
                key: c.key,
                label: c.label,
                quote: c.quote,
                range: c.range,
              }))}
            />
          ) : (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted">
                No transcript stored for this sermon yet. Run{" "}
                <code className="text-xs">scripts/backfill-sermon-transcripts.mjs</code> to pull it from Sermon
                Lab.
              </p>
            </Card>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function CallCard({ c }: { c: SermonCall }) {
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{c.label}</span>
        <Pill tone={c.intensity >= 3 ? "accent" : "muted"}>
          {INTENSITY_WORD[c.intensity] ?? `intensity ${c.intensity}`}
          {c.intensity >= 3 ? " ★" : ""}
        </Pill>
      </div>
      <p className="text-xs text-muted leading-relaxed">{c.blurb}</p>
      {c.quote ? (
        <blockquote className="border-l-2 border-accent-soft-fg/50 pl-3 text-sm italic leading-relaxed">
          “{c.quote}”
        </blockquote>
      ) : (
        <p className="text-xs text-muted italic">No supporting quote recorded.</p>
      )}
      {c.quote && !c.range && (
        <p className="text-xs text-warn-soft-fg">
          This quote is a paraphrase — it couldn&rsquo;t be located verbatim in the transcript, so it
          isn&rsquo;t highlighted below.
        </p>
      )}
    </Card>
  );
}
