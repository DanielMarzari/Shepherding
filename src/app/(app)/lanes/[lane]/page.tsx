import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, LaneTag, Pill } from "@/components/ui";
import {
  LANE_STATS,
  type LaneKey,
  peopleInLane,
  RECENT_LANE_TRANSITIONS,
} from "@/lib/mock";
import Link from "next/link";
import { notFound } from "next/navigation";

const LANE_DESCRIPTIONS: Record<LaneKey, string> = {
  none: "People with no current lane activity — newcomers who haven't engaged yet, or members who have fallen off all lanes.",
  give: "People with active recurring giving. Joining this lane often follows several years of engagement in other lanes.",
  wors: "People attending Sunday services. The entry point for nearly every other lane.",
  outr: "People involved in outreach efforts — soup kitchen, prayer team, mission trips.",
  comm: "People in a small group, men's/women's group, or other community context.",
  serv: "People serving on a team — worship, hospitality, greeters, kids, etc.",
};

export function generateStaticParams() {
  return LANE_STATS.map((l) => ({ lane: l.key }));
}

export default async function LanePage({
  params,
}: {
  params: Promise<{ lane: string }>;
}) {
  const { lane } = await params;
  const laneStats = LANE_STATS.find((l) => l.key === lane);
  if (!laneStats) notFound();
  const laneKey = laneStats.key as LaneKey;
  const people = peopleInLane(laneKey);
  const transitionsIn = RECENT_LANE_TRANSITIONS.filter(
    (t) => t.lane === laneKey,
  );
  const transitionsOut = RECENT_LANE_TRANSITIONS.filter(
    (t) => t.lane === null && t.tenurePrior?.toLowerCase().includes(laneStats.label.toLowerCase().slice(0, 4)),
  );

  return (
    <AppShell active={`lane:${laneKey}`} breadcrumb={`Lanes › ${laneStats.label}`}>
      <div className="px-5 md:px-7 py-7 space-y-6">
        {/* Header */}
        <div>
          <Link href="/lanes" className="text-xs text-muted hover:text-fg">
            ← All lanes
          </Link>
          <div className="flex items-center gap-3 mt-3">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: `var(--lane-${laneKey})` }}
            />
            <h1 className="text-2xl font-semibold tracking-tight">{laneStats.label}</h1>
            <Pill tone="muted">{laneStats.count} people</Pill>
          </div>
          <p className="text-muted text-sm mt-2 max-w-2xl">{LANE_DESCRIPTIONS[laneKey]}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">In this lane</div>
            <div className="tnum text-2xl font-semibold">{laneStats.count}</div>
            <div className="text-xs text-muted mt-1">{laneStats.pct} of active</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Avg tenure</div>
            <div className="tnum text-2xl font-semibold">{laneStats.avgTenure}</div>
            <div className="text-xs text-muted mt-1">in this lane</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">This month</div>
            <div className="tnum text-2xl font-semibold text-good-soft-fg">
              {laneStats.monthDelta}
            </div>
            <div className="text-xs text-muted mt-1">net movement</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted mb-1.5">Visible here</div>
            <div className="tnum text-2xl font-semibold">{people.length}</div>
            <div className="text-xs text-muted mt-1">named in mock data</div>
          </Card>
        </div>

        {/* People in lane */}
        <Card>
          <CardHeader
            title={`People in ${laneStats.label}`}
            right={<span className="text-xs text-muted">{people.length} shown</span>}
          />
          {people.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted">
              No people in this lane in the current sample data.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border-soft">
                  <th className="text-left font-medium px-5 py-2">Person</th>
                  <th className="text-left font-medium px-5 py-2 hidden md:table-cell">Lanes</th>
                  <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Shepherd</th>
                  <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Last seen</th>
                  <th className="text-right font-medium px-5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const row = (
                    <>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar initials={p.initials} size="sm" />
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5 hidden md:table-cell">
                        <div className="flex gap-1 flex-wrap">
                          {p.lanes.length === 0 ? (
                            <LaneTag laneKey="none" short />
                          ) : (
                            p.lanes.map((l) => <LaneTag key={l} laneKey={l} short />)
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 hidden lg:table-cell text-muted">
                        {p.shepherd ?? "— none —"}
                      </td>
                      <td className="px-5 py-2.5 hidden lg:table-cell text-muted">
                        {p.lastSeen}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <Pill tone={p.status === "fading" ? "warn" : p.status === "newcomer" ? "accent" : p.status === "inactive" ? "muted" : "good"}>
                          {p.status === "fading"
                            ? "fading"
                            : p.status === "newcomer"
                              ? "newcomer"
                              : p.status === "inactive"
                                ? "inactive"
                                : "active"}
                        </Pill>
                      </td>
                    </>
                  );
                  return p.slug ? (
                    <tr key={p.name} className="border-b border-border-softer hover:bg-bg-elev-2/60">
                      <td colSpan={5} className="p-0">
                        <Link href={`/people/${p.slug}`} className="block">
                          <table className="w-full">
                            <tbody>
                              <tr>{row}</tr>
                            </tbody>
                          </table>
                        </Link>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.name} className="border-b border-border-softer hover:bg-bg-elev-2/60">
                      {row}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        {/* Recent transitions in/out of this lane */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <CardHeader title={`Recent entries · ${laneStats.label}`} />
            {transitionsIn.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted">
                No new entries this week.
              </div>
            ) : (
              <ul className="divide-y divide-border-softer">
                {transitionsIn.map((t, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium">{t.person}</span>
                      <span className="text-xs text-muted">{t.when}</span>
                    </div>
                    <div className="text-xs text-muted mt-0.5">{t.trigger}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={`Other lanes ${laneStats.label} people are in`} />
            <div className="px-5 py-4 text-sm text-muted">
              {coOccurrenceSummary(people, laneKey)}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function coOccurrenceSummary(
  people: ReturnType<typeof peopleInLane>,
  laneKey: LaneKey,
): string {
  if (people.length === 0) return "—";
  if (laneKey === "none") {
    return "These people aren't in any other lane by definition. They are either brand-new (haven't engaged yet) or have stopped engaging across all lanes.";
  }
  const counts: Record<string, number> = {};
  for (const p of people) {
    for (const l of p.lanes) {
      if (l === laneKey) continue;
      counts[l] = (counts[l] ?? 0) + 1;
    }
  }
  const labels: Record<string, string> = {
    wors: "Worship",
    comm: "Community",
    serv: "Serve",
    give: "Giving",
    outr: "Outreach",
  };
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return "These people are only in this lane — no other lane overlap.";
  return sorted
    .map(([k, n]) => `${labels[k]}: ${n}`)
    .join(" · ");
}
