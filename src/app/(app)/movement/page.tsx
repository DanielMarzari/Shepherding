import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { MOVEMENT_FEED, type MovementEvent } from "@/lib/mock";

const TYPE_META: Record<
  MovementEvent["type"],
  { label: string; tone: "accent" | "good" | "warn" | "muted" | "bad" }
> = {
  join: { label: "Join", tone: "good" },
  exit: { label: "Exit", tone: "bad" },
  handoff: { label: "Handoff", tone: "accent" },
  return: { label: "Return", tone: "good" },
  milestone: { label: "Milestone", tone: "muted" },
  promote: { label: "Promote", tone: "accent" },
};

export default function MovementPage() {
  // Group events by date.
  const byDate = MOVEMENT_FEED.reduce<Record<string, MovementEvent[]>>((acc, e) => {
    (acc[e.date] ??= []).push(e);
    return acc;
  }, {});
  const dates = Object.keys(byDate);

  const counts = {
    joins: MOVEMENT_FEED.filter((e) => e.type === "join").length,
    exits: MOVEMENT_FEED.filter((e) => e.type === "exit").length,
    handoffs: MOVEMENT_FEED.filter((e) => e.type === "handoff").length,
    returns: MOVEMENT_FEED.filter((e) => e.type === "return").length,
  };

  return (
    <AppShell active="Movement" breadcrumb="Movement">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Movement</h1>
            <p className="text-muted text-sm mt-1">
              Joins, exits, handoffs, returns, milestones — every change in how people are
              connected to the church.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs">
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Filter · All types ▾
            </button>
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Last 30 days ▾
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Joins</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">+{counts.joins}</div>
            <div className="text-xs text-muted mt-1">in this window</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Exits</div>
            <div className="tnum text-2xl font-semibold text-bad-soft-fg">−{counts.exits}</div>
            <div className="text-xs text-muted mt-1">left the church</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Handoffs</div>
            <div className="tnum text-2xl font-semibold text-accent">{counts.handoffs}</div>
            <div className="text-xs text-muted mt-1">care reassigned</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Returns</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">{counts.returns}</div>
            <div className="text-xs text-muted mt-1">came back after a gap</div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Activity feed"
            right={
              <span className="text-xs text-muted">
                {MOVEMENT_FEED.length} events
              </span>
            }
          />
          <div className="px-5 py-4 space-y-6">
            {dates.map((date) => (
              <section key={date}>
                <div className="text-xs uppercase tracking-wider text-muted mb-2">
                  {date} · {byDate[date][0].day}
                </div>
                <ul className="space-y-2">
                  {byDate[date].map((e, i) => {
                    const meta = TYPE_META[e.type];
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-3 rounded border border-border-soft px-3 py-2.5"
                      >
                        <Pill tone={meta.tone}>{meta.label}</Pill>
                        <span className="text-sm flex-1">{e.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
