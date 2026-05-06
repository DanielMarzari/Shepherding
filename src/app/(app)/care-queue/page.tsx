import { AppShell } from "@/components/AppShell";
import { Avatar, Card, Pill, Stat } from "@/components/ui";
import { CARE_QUEUE, type CareQueueItem, TODAY_LABEL } from "@/lib/mock";

const TYPE_META: Record<
  CareQueueItem["type"],
  { label: string; color: string; bg: string }
> = {
  "reach-out": { label: "Reach out", color: "var(--accent)", bg: "var(--accent-soft-bg)" },
  match: { label: "Match shepherd", color: "var(--lane-outr)", bg: "var(--lane-outr-bg)" },
  promote: { label: "Promote", color: "var(--good)", bg: "var(--good-soft-bg)" },
  welcome: { label: "Welcome back", color: "var(--lane-wors)", bg: "var(--lane-wors-bg)" },
  celebrate: { label: "Celebrate", color: "var(--lane-give)", bg: "var(--lane-give-bg)" },
};

export default function CareQueuePage() {
  return (
    <AppShell active="Care queue" breadcrumb="Care queue">
      <div className="px-5 md:px-7 py-7">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="text-muted text-xs mb-1">{TODAY_LABEL}</div>
            <h1 className="text-2xl font-semibold tracking-tight">
              This week&apos;s care queue
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs">
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Sort · Priority
            </button>
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Group · Type
            </button>
            <button className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] font-medium">
              + Add manually
            </button>
          </div>
        </div>
        <p className="text-muted text-sm mb-6 max-w-3xl">
          Seventeen things the system thinks you (or your shepherds) should do this week.
          Each item knows the person, the context, and a suggested approach. Click{" "}
          <span className="text-fg font-medium">Done</span>,{" "}
          <span className="text-fg font-medium">Delegate</span>, or{" "}
          <span className="text-fg font-medium">Snooze</span> — your action becomes a logged
          touchpoint on their profile.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Stat label="Must-do today" value={4} valueTone="accent" delta="overdue or high risk" highlight />
          <Stat label="Open · this week" value={17} delta="12 yours · 5 unassigned" />
          <Stat label="Delegated" value={8} delta="awaiting shepherd" />
          <Stat label="Snoozed" value={3} delta="re-surface in 7d" />
          <Stat label="Done · last 7d" value={22} valueTone="good" delta="+18% vs prev wk" />
        </div>

        <div className="flex items-center gap-2 mb-4 text-xs flex-wrap">
          <span className="text-muted mr-1">Filter type:</span>
          <FilterChip active>All · 17</FilterChip>
          <FilterChip>Reach out · 6</FilterChip>
          <FilterChip>Welcome back · 2</FilterChip>
          <FilterChip>Promote · 4</FilterChip>
          <FilterChip>Match shepherd · 3</FilterChip>
          <FilterChip>Celebrate · 2</FilterChip>
        </div>

        <div className="space-y-3">
          {CARE_QUEUE.map((item) => (
            <QueueItem key={item.id} item={item} />
          ))}

          <Card className="p-4 hover:bg-bg-elev-2/40 cursor-pointer transition-colors">
            <div className="flex items-center gap-3 text-sm">
              <Avatar initials="DP" size="sm" />
              <Pill tone="accent">Reach out</Pill>
              <div className="flex-1">
                <span className="font-medium">Daniel Park</span>{" "}
                <span className="text-muted">
                  · 5w no Sunday · sudden quiet, no exit reason · shepherd Jamal
                </span>
              </div>
              <Pill tone="warn">Risk 86</Pill>
            </div>
          </Card>
          <Card className="p-4 hover:bg-bg-elev-2/40 cursor-pointer transition-colors">
            <div className="flex items-center gap-3 text-sm">
              <Avatar initials="EV" size="sm" />
              <Pill tone="accent">Reach out</Pill>
              <div className="flex-1">
                <span className="font-medium">Elena Vasquez</span>{" "}
                <span className="text-muted">
                  · stepped down Hospitality · attendance dropped · shepherd David K.
                </span>
              </div>
              <Pill tone="warn">Risk 68</Pill>
            </div>
          </Card>
          <Card className="p-4 hover:bg-bg-elev-2/40 cursor-pointer transition-colors">
            <div className="flex items-center gap-3 text-sm">
              <Avatar initials="PP" size="sm" />
              <Pill tone="good">Promote</Pill>
              <div className="flex-1">
                <span className="font-medium">Priya Patel</span>{" "}
                <span className="text-muted">
                  · 22mo Tuesday Women&apos;s · ready to co-lead
                </span>
              </div>
              <Pill tone="good">Conf 91</Pill>
            </div>
          </Card>
          <Card className="p-4 hover:bg-bg-elev-2/40 cursor-pointer transition-colors">
            <div className="flex items-center gap-3 text-sm">
              <Avatar initials="TR" size="sm" />
              <Pill tone="good">Promote</Pill>
              <div className="flex-1">
                <span className="font-medium">Tyler Rodriguez</span>{" "}
                <span className="text-muted">
                  · Worship 18mo · trains new vocalists informally · ready for team lead conversation
                </span>
              </div>
              <Pill tone="good">Conf 87</Pill>
            </div>
          </Card>

          <div className="text-center pt-2">
            <button className="text-xs text-accent hover:underline">+ 8 more items in queue</button>
          </div>
        </div>

        <Card className="mt-8">
          <div className="p-4 text-xs text-muted flex items-start gap-3">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="mt-0.5 shrink-0"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16v.01" />
            </svg>
            <p>
              <span className="text-fg">How it works:</span> the queue is generated nightly
              from your custom rules — attendance thresholds, lane stagnation, shepherd
              capacity, life events, newcomer milestones. Shepherds see only items for
              people in their care; you see everything. Every action you take is logged
              on the person&apos;s profile and contributes to their care history.{" "}
              <span className="text-accent underline cursor-pointer">Customize rules →</span>
            </p>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function FilterChip({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
        active
          ? "border-border-soft bg-bg-elev-2 text-fg"
          : "border-border-soft text-muted hover:bg-bg-elev-2/60 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function QueueItem({ item }: { item: CareQueueItem }) {
  const meta = TYPE_META[item.type];
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <Avatar initials={item.initials} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium uppercase tracking-wide"
              style={{ color: meta.color, background: meta.bg }}
            >
              {meta.label}
            </span>
            <Pill tone={item.badge.tone}>{item.badge.label}</Pill>
            {item.overdue ? (
              <>
                <span className="text-xs text-muted">•</span>
                <span className="text-xs text-muted">overdue {item.overdue}</span>
              </>
            ) : null}
          </div>
          <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
            <h3 className="text-base font-semibold">{item.title}</h3>
            <span className="text-xs text-muted">{item.context}</span>
          </div>
          <p className="text-sm text-fg mb-3">{item.body}</p>
          {item.approach ? (
            <div className="rounded border border-border-soft px-3 py-2.5 bg-bg-elev-2/40 mb-3">
              <div className="text-xs text-accent font-medium mb-1.5">Suggested approach</div>
              <p className="text-sm text-fg">{item.approach}</p>
            </div>
          ) : null}
          {item.matches ? (
            <div className="rounded border border-border-soft px-3 py-2.5 bg-bg-elev-2/40 mb-3">
              <div className="text-xs text-accent font-medium mb-1.5">Suggested matches</div>
              <ul className="space-y-2 text-sm">
                {item.matches.map((m) => (
                  <li key={m.name} className="flex items-center justify-between">
                    <div>
                      <span className="text-fg font-medium">{m.name}</span>{" "}
                      <span className="text-muted">· {m.reason}</span>
                    </div>
                    <button className="text-xs px-2 py-1 rounded bg-accent-soft-bg text-accent-soft-fg hover:opacity-80">
                      Pair
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex items-center gap-2 flex-wrap">
            {item.matches ? (
              <button className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium">
                Auto-assign top match
              </button>
            ) : (
              <button className="px-3 py-1.5 rounded bg-accent text-[var(--accent-fg)] text-xs font-medium">
                ✓ Mark done
              </button>
            )}
            {!item.matches ? (
              <button className="px-3 py-1.5 rounded border border-border-soft text-xs text-muted hover:text-fg">
                Delegate ▾
              </button>
            ) : null}
            <button className="px-3 py-1.5 rounded border border-border-soft text-xs text-muted hover:text-fg">
              Snooze 7d
            </button>
            <button className="px-3 py-1.5 rounded border border-border-soft text-xs text-muted hover:text-fg">
              Open profile
            </button>
            <span className="ml-auto text-xs text-muted">
              Suggested by · {item.source}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
