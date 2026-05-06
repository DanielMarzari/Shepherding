import { AppShell } from "@/components/AppShell";
import { Avatar, Card, CardHeader, LaneTag, Pill } from "@/components/ui";
import {
  FOCUS_SHEPHERD,
  RACHEL_FLOCK,
  RACHEL_HANDOFFS,
  RACHEL_UPWARD,
} from "@/lib/mock";

export default function ShepherdsPage() {
  const f = FOCUS_SHEPHERD;
  return (
    <AppShell active="Shepherds" breadcrumb={`Shepherds › ${f.name}`}>
      <div className="px-5 md:px-7 py-7">
        {/* Header */}
        <div className="flex items-start justify-between mb-7 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full grid place-items-center text-lg font-semibold text-white bg-gradient-to-br from-violet-500 to-pink-500">
              {f.initials}
            </div>
            <div>
              <div className="text-muted text-xs mb-0.5">{f.role}</div>
              <h1 className="text-2xl font-semibold tracking-tight">{f.name}</h1>
              <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
                <Pill tone="warn">Over capacity · {f.load}/{f.capacity}</Pill>
                <span className="text-muted">• Wednesday Women&apos;s Group lead</span>
                <span className="text-muted">• Reports to Mark Davies</span>
                <span className="text-muted">• Last contact median {f.avgTimeToTouch}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Compose check-in
            </button>
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">
              Suggest handoffs
            </button>
            <button className="px-2.5 py-1.5 rounded bg-accent text-[var(--accent-fg)] font-medium">
              Open profile
            </button>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <MiniStat label="Currently shepherding" value={f.load} sub={`of ${f.capacity} capacity`} />
          <MiniStat label="Shepherded by" value={f.shepherdedByCount} sub="Mark D · Karen V" />
          <MiniStat
            label="In care · at risk"
            value={f.atRiskInCare}
            sub="Sarah · Daniel · Jenny"
            valueClass="text-warn-soft-fg"
          />
          <MiniStat label="Avg time-to-touch" value={f.avgTimeToTouch} sub="target ≤ 14d" />
          <MiniStat label="Handoffs · 90d" value={f.handoffs90d} sub="2 in · 2 out" />
          <MiniStat label="Tenure" value={f.tenure} sub="since Apr 2022" />
        </div>

        {/* Upward chain */}
        <Card className="p-5 mb-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">↑ Who shepherds {f.name.split(" ")[0]}</h2>
            <span className="text-xs text-muted">
              {f.shepherdedByCount} primary · upward to lead pastor
            </span>
          </div>
          <div className="flex items-stretch gap-3 flex-wrap lg:flex-nowrap">
            {RACHEL_UPWARD.map((s) => (
              <div key={s.name} className="rounded border border-border-soft p-4 flex-1 min-w-[200px]">
                <div className="flex items-center gap-3">
                  <Avatar initials={s.initials} size="md" />
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted">{s.role}</div>
                  </div>
                </div>
                <div className="text-xs text-muted mt-3">{s.note}</div>
                <div className="text-xs text-accent mt-1 font-medium">Last touch · {s.lastTouch}</div>
              </div>
            ))}
            <div className="hidden lg:grid place-items-center px-1">
              <svg width="20" height="20" viewBox="0 0 20 20" className="text-muted">
                <path
                  d="M5 5 L15 10 L5 15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
            <div className="rounded border-2 border-accent/40 bg-accent-soft-bg p-4 flex-1 min-w-[200px]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full grid place-items-center text-sm font-semibold text-white bg-gradient-to-br from-violet-500 to-pink-500">
                  {f.initials}
                </div>
                <div>
                  <div className="font-medium">
                    {f.name} <span className="text-xs text-accent">(focus)</span>
                  </div>
                  <div className="text-xs text-muted">Shepherd · Women&apos;s Care</div>
                </div>
              </div>
              <div className="text-xs text-muted mt-3">{f.load} people in her care</div>
              <div className="text-xs text-accent mt-1 font-medium">Active shepherd</div>
            </div>
          </div>
          <p className="text-xs text-muted mt-4">
            Rachel reports to two pastors. Mark covers leadership; Karen covers programmatic.
            Either can intervene or hand off her flock.
          </p>
        </Card>

        {/* Downward flock */}
        <Card className="mb-5">
          <CardHeader
            title={`↓ Who ${f.name.split(" ")[0]} shepherds`}
            right={
              <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
                <span>{f.load} people</span>
                <span className="hidden md:inline">• Sort · Risk DESC</span>
                <span className="hidden md:inline">
                  • Layout · <span className="text-fg underline">Cards</span> / Tree
                </span>
              </div>
            }
          />
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {RACHEL_FLOCK.map((p) => (
              <FlockCard key={p.name} person={p} />
            ))}
          </div>
        </Card>

        {/* Multi-shepherded + handoff history */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <Card className="xl:col-span-7 p-5">
            <h2 className="text-sm font-semibold mb-1">People Rachel co-shepherds</h2>
            <p className="text-xs text-muted mb-4">
              Three of her flock have a second shepherd. Helpful when one of them goes on
              sabbatical.
            </p>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border-soft">
                  <th className="text-left font-medium py-2">Person</th>
                  <th className="text-left font-medium py-2">Co-shepherd</th>
                  <th className="text-left font-medium py-2">Why both</th>
                  <th className="text-right font-medium py-2 tnum">Since</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border-softer">
                  <td className="py-2.5">Sarah Chen</td>
                  <td className="py-2.5">David Kim</td>
                  <td className="py-2.5 text-muted">Marriage in transition</td>
                  <td className="py-2.5 text-right tnum text-muted">Mar 2026</td>
                </tr>
                <tr className="border-b border-border-softer">
                  <td className="py-2.5">Maria Velez</td>
                  <td className="py-2.5">Karen Voss</td>
                  <td className="py-2.5 text-muted">Outreach team lead</td>
                  <td className="py-2.5 text-right tnum text-muted">Jan 2026</td>
                </tr>
                <tr>
                  <td className="py-2.5">Sabrina Hill</td>
                  <td className="py-2.5">Jamal Williams</td>
                  <td className="py-2.5 text-muted">College ministry</td>
                  <td className="py-2.5 text-right tnum text-muted">Sep 2025</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card className="xl:col-span-5 p-5">
            <h2 className="text-sm font-semibold mb-1">Handoff history · Rachel</h2>
            <p className="text-xs text-muted mb-4">When she gave or received care of someone.</p>
            <ul className="space-y-3 text-sm">
              {RACHEL_HANDOFFS.map((h, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-xs text-muted w-12 shrink-0 tnum">{h.when}</span>
                  <div className="text-muted">{h.text}</div>
                </li>
              ))}
            </ul>
            <button className="mt-4 text-xs text-accent">
              Suggest reassignments to lower load →
            </button>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function MiniStat({
  label,
  value,
  sub,
  valueClass = "",
}: {
  label: string;
  value: string | number;
  sub: string;
  valueClass?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={`tnum text-2xl font-semibold ${valueClass}`}>{value}</div>
      <div className="text-xs text-muted mt-0.5">{sub}</div>
    </Card>
  );
}

function FlockCard({
  person,
}: {
  person: (typeof RACHEL_FLOCK)[number];
}) {
  const isAtRisk = person.riskLevel === "high";
  const ringClass = isAtRisk ? "ring-1 ring-warn/40 border-warn/30" : "";
  return (
    <div className={`rounded border border-border-soft p-3 ${ringClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar initials={person.initials} size="sm" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{person.name}</div>
            <div className="text-xs text-muted truncate">
              {person.tag
                ? person.tag
                : person.coShepherd
                  ? `+1 co-shepherd`
                  : "solo"}
            </div>
          </div>
        </div>
        {person.risk ? (
          <Pill tone={isAtRisk ? "warn" : "muted"}>{`RISK ${person.risk}`}</Pill>
        ) : (
          <Pill tone="muted">SOLID</Pill>
        )}
      </div>
      <div className="text-xs text-muted mt-2.5">Last seen {person.lastSeen}</div>
      <div className="text-xs text-muted">Last touch · {person.lastTouch}</div>
      <div className="flex gap-1 mt-2 flex-wrap">
        {person.lanes.map((l) => (
          <LaneTag key={l} laneKey={l} short />
        ))}
      </div>
    </div>
  );
}
