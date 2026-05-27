import { Card, CardHeader } from "@/components/ui";
import {
  type TimelineCategory,
  type TimelineEvent,
  getPersonTimeline,
} from "@/lib/person-timeline";

const CATEGORY_STYLE: Record<
  TimelineCategory,
  { dot: string; label: string; ring: string }
> = {
  personal: {
    dot: "bg-muted",
    label: "text-muted",
    ring: "ring-muted/30",
  },
  community: {
    dot: "bg-accent",
    label: "text-accent",
    ring: "ring-accent/30",
  },
  serving: {
    dot: "bg-good-soft-fg",
    label: "text-good-soft-fg",
    ring: "ring-good-soft-fg/30",
  },
  forms: {
    dot: "bg-warn-soft-fg",
    label: "text-warn-soft-fg",
    ring: "ring-warn-soft-fg/30",
  },
};

const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  personal: "personal",
  community: "groups",
  serving: "teams",
  forms: "forms",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function groupByYear(
  events: TimelineEvent[],
): Array<{ year: string; events: TimelineEvent[] }> {
  const out: Array<{ year: string; events: TimelineEvent[] }> = [];
  let current: { year: string; events: TimelineEvent[] } | null = null;
  for (const e of events) {
    const y = e.at.slice(0, 4);
    if (!current || current.year !== y) {
      current = { year: y, events: [] };
      out.push(current);
    }
    current.events.push(e);
  }
  return out;
}

/** Skinny vertical activity timeline meant to live in the right column
 *  of /people/[slug]. Server-rendered — the data set is small (dozens
 *  of milestones per person, not hundreds, because attendance / serve
 *  events are collapsed per group / team in person-timeline.ts).
 *
 *  Grouped by year so a long-tenured member doesn't become a wall of
 *  identical-looking "joined a group" rows. Newest first. */
export async function PersonTimeline({
  orgId,
  slug,
}: {
  orgId: number;
  slug: string;
}) {
  const events = getPersonTimeline(orgId, slug);
  const byYear = groupByYear(events);
  return (
    <Card>
      <CardHeader
        title="Activity timeline"
        right={
          <span className="text-xs text-muted">
            {events.length.toLocaleString()} event
            {events.length === 1 ? "" : "s"}
          </span>
        }
      />
      <div className="px-4 py-4 max-h-[calc(100vh-200px)] overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-xs text-muted text-center py-8">
            No tracked activity yet — once PCO data syncs the timeline
            fills in.
          </p>
        ) : (
          <ol className="space-y-5">
            {byYear.map((y) => (
              <li key={y.year}>
                <div className="text-[10px] uppercase tracking-wider text-subtle font-medium mb-2 pl-1">
                  {y.year}
                </div>
                <ul className="space-y-3 relative pl-4">
                  {/* The vertical rail behind every event. */}
                  <span
                    aria-hidden
                    className="absolute left-1 top-1 bottom-1 w-px bg-border-soft"
                  />
                  {y.events.map((e, i) => {
                    const style = CATEGORY_STYLE[e.category];
                    return (
                      <li
                        key={`${y.year}-${i}-${e.at}`}
                        className="relative pl-3"
                      >
                        <span
                          aria-hidden
                          className={`absolute -left-[3px] top-1.5 w-2 h-2 rounded-full ${style.dot} ring-2 ${style.ring}`}
                        />
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[10px] text-subtle tnum shrink-0">
                            {fmtDate(e.at)}
                          </span>
                          <span
                            className={`text-[9px] uppercase tracking-wider ${style.label} shrink-0`}
                          >
                            {CATEGORY_LABEL[e.category]}
                          </span>
                        </div>
                        <div className="text-xs text-fg font-medium mt-0.5">
                          {e.title}
                        </div>
                        {e.detail && (
                          <div className="text-[11px] text-muted truncate">
                            {e.detail}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

export function PersonTimelineSkeleton() {
  return (
    <Card className="p-4 animate-pulse">
      <div className="h-3 w-24 bg-bg-elev-2 rounded mb-4" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="space-y-1.5 mb-3">
          <div className="h-2 w-16 bg-bg-elev-2/70 rounded" />
          <div className="h-2.5 w-full bg-bg-elev-2/50 rounded" />
        </div>
      ))}
    </Card>
  );
}
