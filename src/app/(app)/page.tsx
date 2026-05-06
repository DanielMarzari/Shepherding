import { AppShell } from "@/components/AppShell";
import {
  AT_RISK,
  GROUP_HEALTH,
  MOVEMENT_THIS_WEEK,
  NEXT_STEP_READY,
  SHEPHERD_LOAD,
  STATS,
  TODAY_LABEL,
} from "@/lib/mock";
import Link from "next/link";

export default function HomePage() {
  return (
    <AppShell active="Home" breadcrumb="Home">
      <div className="px-5 md:px-7 py-7">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <div className="text-muted text-xs mb-1">{TODAY_LABEL}</div>
            <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
            <p className="text-muted text-sm mt-1 max-w-xl">
              Five may be slipping. Three are ready for a step forward. Here&apos;s how the flock
              is moving this week.
            </p>
          </div>
          <div className="hidden lg:flex items-center gap-2 text-xs">
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted hover:text-fg transition-colors">
              All ministries ▾
            </button>
            <Link
              href="/care-queue"
              className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] font-medium"
            >
              Open care queue
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Stat label="Active people" value={STATS.active} delta="+1.2% MoM" />
          <Stat
            label="Joined · Aug"
            value={`+${STATS.joinedMonth}`}
            valueTone="accent"
            delta="8 fam · 4 ind"
          />
          <Stat
            label="Departed · Aug"
            value={`−${STATS.departedMonth}`}
            delta="3 mov · 2 inact · 1 left"
          />
          <Stat
            label="Unshepherded"
            value={STATS.unshepherded}
            delta="7.0% of active"
          />
          <Stat
            label="Next-step ready"
            value={STATS.nextStepReady}
            valueTone="accent"
            delta="3 lead · 6 group · 5 team"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-border-soft">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Falling through the cracks</h2>
                <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted tnum">
                  23
                </span>
              </div>
              <div className="hidden md:flex items-center gap-3 text-xs text-muted">
                <span>Sort · Risk score</span>
                <span>Filter · All</span>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border-soft">
                  <th className="text-left font-medium px-5 py-2">Person</th>
                  <th className="text-left font-medium px-5 py-2 hidden md:table-cell">Last touch</th>
                  <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Shepherd</th>
                  <th className="text-left font-medium px-5 py-2 hidden xl:table-cell">Signal</th>
                  <th className="text-right font-medium px-5 py-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {AT_RISK.map((p) => (
                  <tr
                    key={p.name}
                    className="border-b border-border-softer hover:bg-bg-elev-2/60"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted">{p.context}</div>
                    </td>
                    <td className="px-5 py-3 text-muted hidden md:table-cell">
                      {p.lastSunday}
                    </td>
                    <td className="px-5 py-3 hidden lg:table-cell">
                      {p.shepherd ?? <span className="text-muted">— none —</span>}
                    </td>
                    <td className="px-5 py-3 text-muted hidden xl:table-cell">
                      {p.reason}
                    </td>
                    <td className="px-5 py-3 text-right tnum">
                      <span
                        className={
                          p.riskLevel === "high"
                            ? "text-warn-soft-fg"
                            : p.riskLevel === "med"
                              ? "text-warn-soft-fg"
                              : "text-muted"
                        }
                      >
                        {p.riskLevel === "high"
                          ? `High · ${p.risk}`
                          : p.riskLevel === "med"
                            ? `Med · ${p.risk}`
                            : `Low · ${p.risk}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-border-soft text-xs text-muted flex justify-between">
              <span>Showing {AT_RISK.length} of 23</span>
              <Link href="/care-queue" className="text-accent">View all →</Link>
            </div>
          </Card>

          <Card>
            <div className="px-5 pt-4 pb-3 border-b border-border-soft flex items-center justify-between">
              <h2 className="text-sm font-semibold">Next-step ready</h2>
              <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted tnum">
                {STATS.nextStepReady}
              </span>
            </div>
            <ul>
              {NEXT_STEP_READY.map((p) => (
                <li
                  key={p.name}
                  className="px-5 py-3.5 border-b border-border-softer last:border-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{p.name}</span>
                    <span className="text-xs text-accent">{p.suggestion}</span>
                  </div>
                  <div className="text-xs text-muted">{p.detail}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
          <Card>
            <div className="px-5 pt-4 pb-3 border-b border-border-soft">
              <h2 className="text-sm font-semibold">Movement · this week</h2>
            </div>
            <ul>
              {MOVEMENT_THIS_WEEK.map((m, i) => (
                <li
                  key={i}
                  className="px-5 py-3 border-b border-border-softer last:border-0 flex items-start gap-3 text-sm"
                >
                  <span className="text-xs text-muted w-10 shrink-0">{m.day}</span>
                  <span className="text-fg">{m.text}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="px-5 pt-4 pb-3 border-b border-border-soft flex items-center justify-between">
              <h2 className="text-sm font-semibold">Shepherd workload</h2>
              <span className="text-xs text-muted">Top 5 by load</span>
            </div>
            <ul className="px-5 py-2 space-y-3 text-sm">
              {SHEPHERD_LOAD.map((s) => {
                const pct = Math.min(100, (s.load / s.capacity) * 100);
                const tone =
                  s.status === "over"
                    ? "var(--bad)"
                    : s.status === "full"
                      ? "var(--warn)"
                      : "var(--accent)";
                return (
                  <li key={s.name}>
                    <div className="flex justify-between">
                      <span>{s.name}</span>
                      <span className="tnum text-muted">
                        {s.load} / {s.capacity}
                      </span>
                    </div>
                    <div className="h-1 bg-bg-elev-2 rounded mt-1.5 overflow-hidden">
                      <div
                        className="h-full"
                        style={{ width: `${pct}%`, background: tone }}
                      />
                    </div>
                    {s.note ? (
                      <div
                        className="text-xs mt-1"
                        style={{
                          color:
                            s.status === "over" ? "var(--bad)" : "var(--accent)",
                        }}
                      >
                        {s.note}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <div className="px-5 pt-4 pb-3 border-b border-border-soft flex items-center justify-between">
              <h2 className="text-sm font-semibold">Group health</h2>
              <span className="text-xs text-muted">12-wk trend</span>
            </div>
            <ul>
              {GROUP_HEALTH.map((g) => (
                <li
                  key={g.name}
                  className="px-5 py-3 border-b border-border-softer last:border-0 flex items-center gap-3 text-sm"
                >
                  <svg className="spark" width="60" height="20" viewBox="0 0 60 20">
                    <path
                      d={g.spark}
                      stroke={
                        g.state === "growing"
                          ? "var(--good)"
                          : g.state === "shrinking"
                            ? "var(--bad)"
                            : "var(--fg-subtle)"
                      }
                    />
                  </svg>
                  <div className="flex-1">
                    <div>{g.name}</div>
                    <div className="text-xs text-muted">
                      {g.members - g.delta} → {g.members} ·{" "}
                      {g.state === "growing"
                        ? "↑ growing"
                        : g.state === "shrinking"
                          ? "↓ paused"
                          : "steady"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  delta,
  valueTone,
}: {
  label: string;
  value: string | number;
  delta: string;
  valueTone?: "accent" | "default";
}) {
  return (
    <div className="rounded-[10px] bg-bg-elev border border-border-soft p-4">
      <div className="text-xs text-muted mb-1.5">{label}</div>
      <div
        className={`tnum text-2xl font-semibold ${
          valueTone === "accent" ? "text-accent" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-muted mt-1">{delta}</div>
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[10px] bg-bg-elev border border-border-soft overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}
