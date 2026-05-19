import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { LANE_STATS } from "@/lib/mock";

const LANE_DESCRIPTIONS: Record<string, string> = {
  wors: "Sunday attendees — the entry point for almost every other lane.",
  comm: "Small groups, men's / women's groups, other community contexts.",
  serv: "Team serving — worship, hospitality, greeters, kids, etc.",
  give: "Active recurring giving.",
  outr: "Outreach — soup kitchen, prayer team, mission trips.",
  none: "Newcomers who haven't engaged yet, or members who've fallen off all lanes.",
};

export default function LanesListPage() {
  return (
    <AppShell active="Lanes" breadcrumb="Lanes">
      <div className="px-5 md:px-7 py-7 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lanes</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">
            Each lane is a way to belong. Most people move through several of
            them; the goal is to never let anyone sit in &ldquo;None&rdquo; for
            long. Pick a lane to see who&apos;s in it.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {LANE_STATS.map((lane) => (
            <Link key={lane.key} href={`/lanes/${lane.key}`} className="block">
              <Card className="p-4 h-full hover:border-accent transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: `var(--lane-${lane.key})` }}
                  />
                  <span className="font-semibold">{lane.label}</span>
                  <span className="ml-auto tnum text-sm text-muted">
                    {lane.count}
                  </span>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  {LANE_DESCRIPTIONS[lane.key] ?? ""}
                </p>
                <div className="text-[10px] text-subtle mt-2 tnum">
                  {lane.pct} of active · avg tenure {lane.avgTenure} ·{" "}
                  <span
                    className={
                      lane.monthDelta.startsWith("-")
                        ? "text-warn-soft-fg"
                        : "text-good-soft-fg"
                    }
                  >
                    {lane.monthDelta}
                  </span>{" "}
                  this month
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
