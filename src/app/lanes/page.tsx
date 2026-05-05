import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, LaneTag } from "@/components/ui";
import {
  LANE_SEQUENCES,
  LANE_STATS,
  RECENT_LANE_TRANSITIONS,
  SAMPLE_JOURNEYS,
  type LaneKey,
} from "@/lib/mock";

export default function LanesPage() {
  return (
    <AppShell active="Activity / Lanes" breadcrumb="Activity / Lanes">
      <div className="px-5 md:px-7 py-7">
        <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-muted text-xs mb-1">Lane movement & tenure · 12mo window</div>
            <h1 className="text-2xl font-semibold tracking-tight">Activity / Lanes</h1>
            <p className="text-muted text-sm mt-1 max-w-xl">
              How people enter, sequence, and dwell in each lane of church life.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">View · Flow ▾</button>
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">Cohort · All ▾</button>
            <button className="px-2.5 py-1.5 rounded border border-border-soft text-muted">Active only ✓</button>
          </div>
        </div>

        {/* 5 lane stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {LANE_STATS.map((lane) => (
            <Card key={lane.key} className="p-4">
              <div className="flex items-center justify-between mb-1">
                <LaneTag laneKey={lane.key} />
                <span className="text-xs text-muted">{lane.pct} of active</span>
              </div>
              <div className="tnum text-2xl font-semibold mt-2">{lane.count}</div>
              <div className="text-xs text-muted mt-0.5">
                avg tenure {lane.avgTenure} · {lane.monthDelta}
              </div>
            </Card>
          ))}
        </div>

        {/* Flow + sequences */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-5">
          <Card className="xl:col-span-8 p-5">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-sm font-semibold">Lane flow · last 12 months</h2>
              <span className="text-xs text-muted hidden md:inline">From which lane → into which next lane</span>
            </div>
            <p className="text-xs text-muted mb-4">
              Width = number of people who added that next lane after the source.
            </p>
            <SankeyFlow />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 text-xs">
              <div className="rounded border border-border-soft px-3 py-2">
                <div className="text-muted">Strongest path</div>
                <div>
                  <LaneTag laneKey="wors" short /> →{" "}
                  <LaneTag laneKey="comm" short /> →{" "}
                  <LaneTag laneKey="serv" short />
                </div>
                <div className="text-muted mt-0.5 tnum">142 people · avg 14mo</div>
              </div>
              <div className="rounded border border-border-soft px-3 py-2">
                <div className="text-muted">Slow path</div>
                <div>
                  <LaneTag laneKey="wors" short /> →{" "}
                  <LaneTag laneKey="give" short />
                </div>
                <div className="text-muted mt-0.5 tnum">98 people · avg 27mo</div>
              </div>
              <div className="rounded border border-border-soft px-3 py-2">
                <div className="text-muted">Stuck at one lane</div>
                <div>
                  <LaneTag laneKey="wors" short /> only
                </div>
                <div className="text-muted mt-0.5 tnum">112 people · invite candidates</div>
              </div>
            </div>
          </Card>

          <Card className="xl:col-span-4 p-5">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-sm font-semibold">Common journey sequences</h2>
              <span className="text-xs text-muted">order &amp; count</span>
            </div>
            <p className="text-xs text-muted mb-4">
              Lanes added in chronological order. People may add more later.
            </p>
            <ul className="space-y-3 text-sm">
              {LANE_SEQUENCES.map((s, i) => (
                <li
                  key={i}
                  className={`rounded border p-3 ${
                    s.highlight
                      ? "border-warn/30 ring-1 ring-warn/20"
                      : "border-border-soft"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                    {s.seq.map((k, idx) => (
                      <span key={idx} className="flex items-center gap-1.5">
                        <LaneTag laneKey={k} short />
                        {idx < s.seq.length - 1 ? (
                          <span className="text-muted">→</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                  <div className="flex justify-between">
                    <span>{s.label}</span>
                    <span
                      className={`tnum ${s.highlight ? "text-warn-soft-fg" : "text-accent"}`}
                    >
                      {s.count}
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">{s.note}</div>
                </li>
              ))}
            </ul>
            <button className="mt-4 text-xs text-accent">Explore all 28 sequences →</button>
          </Card>
        </div>

        {/* Transitions + sample journeys */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <Card className="xl:col-span-7">
            <CardHeader
              title="Lane transitions · this week"
              right={<span className="text-xs text-muted">22 changes</span>}
            />
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border-soft">
                  <th className="text-left font-medium px-5 py-2">Person</th>
                  <th className="text-left font-medium px-5 py-2">Change</th>
                  <th className="text-left font-medium px-5 py-2 hidden md:table-cell">Trigger</th>
                  <th className="text-left font-medium px-5 py-2 hidden lg:table-cell">Tenure prior</th>
                  <th className="text-right font-medium px-5 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_LANE_TRANSITIONS.map((t, i) => (
                  <tr key={i} className="border-b border-border-softer hover:bg-bg-elev-2/60">
                    <td className="px-5 py-2.5">{t.person}</td>
                    <td className="px-5 py-2.5">
                      {t.lane ? (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{
                            background: `var(--lane-${t.lane}-bg)`,
                            color: `var(--lane-${t.lane})`,
                          }}
                        >
                          {t.change}
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elev-2 text-muted">
                          {t.change}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-muted hidden md:table-cell">{t.trigger}</td>
                    <td className="px-5 py-2.5 tnum text-muted hidden lg:table-cell">{t.tenurePrior}</td>
                    <td className="px-5 py-2.5 text-muted text-right">{t.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-border-soft text-xs text-muted flex justify-between">
              <span>Showing {RECENT_LANE_TRANSITIONS.length} of 22</span>
              <span className="text-accent">View all →</span>
            </div>
          </Card>

          <Card className="xl:col-span-5 p-5">
            <h2 className="text-sm font-semibold mb-1">Sample journeys</h2>
            <p className="text-xs text-muted mb-4">
              A handful of individual paths — see Person profile for full timeline.
            </p>
            <div className="space-y-5">
              {SAMPLE_JOURNEYS.map((j) => (
                <div key={j.name}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="font-medium text-sm">{j.name}</span>
                    <span className="text-xs text-muted tnum">{j.summary}</span>
                  </div>
                  <Journey points={j.points} />
                  <div
                    className={`text-xs mt-4 ${
                      j.note.includes("stuck") || j.note.includes("Worship-only")
                        ? "text-warn-soft-fg"
                        : "text-accent"
                    }`}
                  >
                    {j.note}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Journey({
  points,
}: {
  points: { lane: LaneKey | null; label: string; at: number }[];
}) {
  return (
    <div className="relative h-7">
      <div className="absolute inset-0 flex items-center">
        <div className="h-px bg-border-soft w-full" />
      </div>
      {points.map((p, i) => (
        <div key={i} className="absolute" style={{ left: `${p.at}%` }}>
          <div className="-translate-x-1/2">
            <div
              className="w-3 h-3 rounded-full mt-2.5"
              style={{
                background: p.lane ? `var(--lane-${p.lane})` : "transparent",
                border: p.lane ? "none" : "1px solid var(--fg-subtle)",
              }}
            />
            <div className="text-[10px] text-muted mt-1 whitespace-nowrap">{p.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SankeyFlow() {
  // Static sankey — same as v2 mockup. Real version computes from data.
  return (
    <svg viewBox="0 0 700 360" className="w-full h-[380px]">
      <g fontFamily="Inter" fontSize="11" fill="var(--fg)">
        {/* Source */}
        <rect x="40" y="40" width="14" height="40" fill="var(--lane-wors)" rx="2" />
        <text x="60" y="55">Worship</text>
        <text x="60" y="69" fill="var(--fg-muted)" fontSize="10">487 people · entry</text>

        <rect x="40" y="110" width="14" height="32" fill="var(--lane-comm)" rx="2" />
        <text x="60" y="124">Community</text>
        <text x="60" y="138" fill="var(--fg-muted)" fontSize="10">298 people</text>

        <rect x="40" y="172" width="14" height="22" fill="var(--lane-serv)" rx="2" />
        <text x="60" y="186">Serve</text>
        <text x="60" y="200" fill="var(--fg-muted)" fontSize="10">221 people</text>

        <rect x="40" y="222" width="14" height="14" fill="var(--lane-give)" rx="2" />
        <text x="60" y="232">Giving</text>
        <text x="60" y="246" fill="var(--fg-muted)" fontSize="10">312 people</text>

        <rect x="40" y="262" width="14" height="10" fill="var(--lane-outr)" rx="2" />
        <text x="60" y="270">Outreach</text>
        <text x="60" y="284" fill="var(--fg-muted)" fontSize="10">134 people</text>

        {/* Right column */}
        <rect x="640" y="40" width="14" height="34" fill="var(--lane-comm)" rx="2" />
        <text x="630" y="55" textAnchor="end">Community</text>
        <text x="630" y="69" textAnchor="end" fill="var(--fg-muted)" fontSize="10">186 next-step</text>

        <rect x="640" y="100" width="14" height="28" fill="var(--lane-serv)" rx="2" />
        <text x="630" y="113" textAnchor="end">Serve</text>
        <text x="630" y="127" textAnchor="end" fill="var(--fg-muted)" fontSize="10">142 next-step</text>

        <rect x="640" y="156" width="14" height="20" fill="var(--lane-give)" rx="2" />
        <text x="630" y="167" textAnchor="end">Giving</text>
        <text x="630" y="181" textAnchor="end" fill="var(--fg-muted)" fontSize="10">98 next-step</text>

        <rect x="640" y="200" width="14" height="14" fill="var(--lane-outr)" rx="2" />
        <text x="630" y="211" textAnchor="end">Outreach</text>
        <text x="630" y="225" textAnchor="end" fill="var(--fg-muted)" fontSize="10">61 next-step</text>

        <rect x="640" y="240" width="14" height="22" fill="var(--fg-subtle)" rx="2" />
        <text x="630" y="252" textAnchor="end">No next lane</text>
        <text x="630" y="266" textAnchor="end" fill="var(--fg-muted)" fontSize="10">112 stopped</text>
      </g>

      {/* Worship → */}
      <path d="M54 60 C 250 60, 450 57, 640 57" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="22" />
      <path d="M54 65 C 250 95, 450 110, 640 114" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="18" />
      <path d="M54 70 C 250 140, 450 160, 640 166" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="14" />
      <path d="M54 76 C 250 200, 450 205, 640 207" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="9" />
      <path d="M54 78 C 250 250, 450 250, 640 251" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="14" />

      {/* Community → */}
      <path d="M54 120 C 250 80, 450 78, 640 70" fill="none" stroke="var(--lane-comm)" strokeOpacity="0.35" strokeWidth="9" />
      <path d="M54 124 C 250 115, 450 113, 640 110" fill="none" stroke="var(--lane-comm)" strokeOpacity="0.35" strokeWidth="13" />
      <path d="M54 128 C 250 145, 450 160, 640 164" fill="none" stroke="var(--lane-comm)" strokeOpacity="0.35" strokeWidth="11" />
      <path d="M54 134 C 250 195, 450 207, 640 209" fill="none" stroke="var(--lane-comm)" strokeOpacity="0.35" strokeWidth="6" />

      {/* Serve → */}
      <path d="M54 178 C 250 105, 450 109, 640 113" fill="none" stroke="var(--lane-serv)" strokeOpacity="0.35" strokeWidth="6" />
      <path d="M54 184 C 250 170, 450 165, 640 167" fill="none" stroke="var(--lane-serv)" strokeOpacity="0.35" strokeWidth="9" />
      <path d="M54 188 C 250 210, 450 211, 640 211" fill="none" stroke="var(--lane-serv)" strokeOpacity="0.35" strokeWidth="6" />
      <path d="M54 191 C 250 250, 450 252, 640 252" fill="none" stroke="var(--lane-serv)" strokeOpacity="0.35" strokeWidth="5" />

      {/* Giving → */}
      <path d="M54 228 C 250 215, 450 213, 640 213" fill="none" stroke="var(--lane-give)" strokeOpacity="0.35" strokeWidth="4" />
      <path d="M54 233 C 250 252, 450 254, 640 254" fill="none" stroke="var(--lane-give)" strokeOpacity="0.35" strokeWidth="6" />

      {/* Outreach */}
      <path d="M54 267 C 250 215, 450 214, 640 214" fill="none" stroke="var(--lane-outr)" strokeOpacity="0.35" strokeWidth="3" />
      <path d="M54 271 C 250 255, 450 256, 640 257" fill="none" stroke="var(--lane-outr)" strokeOpacity="0.35" strokeWidth="4" />

      <text x="350" y="335" textAnchor="middle" fill="var(--fg-muted)" fontSize="11">
        Most common entry: Worship → Community → Serve · 142 people
      </text>
    </svg>
  );
}
