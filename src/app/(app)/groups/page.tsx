import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Pill } from "@/components/ui";
import { ALL_GROUPS } from "@/lib/mock";

const TYPE_TONE: Record<string, "accent" | "good" | "warn" | "muted"> = {
  Community: "good",
  Serve: "accent",
  Outreach: "warn",
};

export default function GroupsPage() {
  const groups = [...ALL_GROUPS].sort((a, b) => {
    const order = { growing: 0, steady: 1, paused: 2, shrinking: 3 } as const;
    if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
    return a.name.localeCompare(b.name);
  });

  const counts = {
    growing: ALL_GROUPS.filter((g) => g.state === "growing").length,
    steady: ALL_GROUPS.filter((g) => g.state === "steady").length,
    paused: ALL_GROUPS.filter((g) => g.state === "paused").length,
    shrinking: ALL_GROUPS.filter((g) => g.state === "shrinking").length,
  };

  return (
    <AppShell active="Groups" breadcrumb="Groups">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
            <p className="text-muted text-sm mt-1">
              Every group, team, and ministry context — sorted by health.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs">
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Filter · All types ▾
            </button>
            <button className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] font-medium">
              + New group
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Growing</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">{counts.growing}</div>
            <div className="text-xs text-muted mt-1">12-week trend</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Steady</div>
            <div className="tnum text-2xl font-semibold">{counts.steady}</div>
            <div className="text-xs text-muted mt-1">flat ±1</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Paused</div>
            <div className="tnum text-2xl font-semibold text-warn-soft-fg">{counts.paused}</div>
            <div className="text-xs text-muted mt-1">on hold this season</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Shrinking</div>
            <div className="tnum text-2xl font-semibold">{counts.shrinking}</div>
            <div className="text-xs text-muted mt-1">needs attention</div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="All groups"
            right={<span className="text-xs text-muted">{ALL_GROUPS.length} total</span>}
          />
          <ul className="divide-y divide-border-softer">
            {groups.map((g) => (
              <li key={g.slug} className="px-5 py-4 hover:bg-bg-elev-2/40">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h3 className="font-medium">{g.name}</h3>
                      <Pill tone={TYPE_TONE[g.type] ?? "muted"}>{g.type}</Pill>
                      {g.state === "paused" && <Pill tone="warn">paused</Pill>}
                      {g.state === "shrinking" && <Pill tone="warn">shrinking</Pill>}
                      {g.state === "growing" && <Pill tone="good">growing</Pill>}
                    </div>
                    <div className="text-xs text-muted mt-1">
                      Lead: <span className="text-fg">{g.lead}</span>
                    </div>
                    <div className="text-xs text-muted">{g.meeting}</div>
                  </div>
                  <div className="flex items-center gap-5">
                    <svg className="spark" width="80" height="24" viewBox="0 0 60 20">
                      <path
                        d={g.spark}
                        stroke={
                          g.state === "growing"
                            ? "var(--good)"
                            : g.state === "shrinking" || g.state === "paused"
                              ? "var(--bad)"
                              : "var(--fg-subtle)"
                        }
                      />
                    </svg>
                    <div className="text-right">
                      <div className="tnum text-lg font-semibold">{g.members}</div>
                      <div className="text-xs text-muted">
                        {g.delta12w > 0 ? "+" : ""}
                        {g.delta12w} in 12w
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
