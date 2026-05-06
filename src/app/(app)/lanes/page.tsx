import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, LaneTag } from "@/components/ui";
import {
  LANE_SEQUENCES,
  LANE_STATS,
  PEOPLE_PROFILES,
  RECENT_LANE_TRANSITIONS,
} from "@/lib/mock";
import Link from "next/link";

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

        {/* 6 lane stat cards (incl. No activity) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {LANE_STATS.map((lane) => (
            <Card
              key={lane.key}
              className={`p-4 ${lane.key === "none" ? "border-dashed" : ""}`}
            >
              <div className="flex items-center justify-between mb-1">
                <LaneTag laneKey={lane.key} />
                <span className="text-xs text-muted">{lane.pct}</span>
              </div>
              <div className="tnum text-2xl font-semibold mt-2">{lane.count}</div>
              <div className="text-xs text-muted mt-0.5">
                {lane.key === "none" ? lane.monthDelta : `avg ${lane.avgTenure} · ${lane.monthDelta}`}
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
            <h2 className="text-sm font-semibold mb-1">Notable individual journeys</h2>
            <p className="text-xs text-muted mb-4">
              Open a person to see their full lane timeline, lane tenure, and pastoral notes.
            </p>
            <ul className="space-y-2">
              {Object.values(PEOPLE_PROFILES).map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/people/${p.slug}`}
                    className="block rounded border border-border-soft p-3 hover:bg-bg-elev-2/60 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{p.name}</span>
                      <span className="text-xs text-muted tnum">{p.tenureYears} yr</span>
                    </div>
                    <div className="flex items-center gap-1 mb-1.5 flex-wrap">
                      {p.journey.map((pt, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <LaneTag laneKey={pt.lane ?? "none"} short />
                          {i < p.journey.length - 1 ? (
                            <span className="text-muted text-[10px]">→</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                    <div
                      className={`text-xs ${
                        p.noteTone === "warn"
                          ? "text-warn-soft-fg"
                          : p.noteTone === "good"
                            ? "text-accent"
                            : "text-muted"
                      }`}
                    >
                      {p.note}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted mt-4">
              Full activity timelines live on each person&apos;s profile.
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function SankeyFlow() {
  return (
    <svg viewBox="0 0 700 380" className="w-full h-[400px]">
      <g fontFamily="Inter" fontSize="11" fill="var(--fg)">
        {/* SOURCE column */}
        <rect x="40" y="14" width="14" height="20" fill="var(--lane-none)" rx="2" />
        <text x="60" y="24">No activity</text>
        <text x="60" y="38" fill="var(--fg-muted)" fontSize="10">27 newcomers entering</text>

        <rect x="40" y="56" width="14" height="40" fill="var(--lane-wors)" rx="2" />
        <text x="60" y="71">Worship</text>
        <text x="60" y="85" fill="var(--fg-muted)" fontSize="10">487 people · entry</text>

        <rect x="40" y="120" width="14" height="32" fill="var(--lane-comm)" rx="2" />
        <text x="60" y="134">Community</text>
        <text x="60" y="148" fill="var(--fg-muted)" fontSize="10">298 people</text>

        <rect x="40" y="174" width="14" height="22" fill="var(--lane-serv)" rx="2" />
        <text x="60" y="188">Serve</text>
        <text x="60" y="202" fill="var(--fg-muted)" fontSize="10">221 people</text>

        <rect x="40" y="218" width="14" height="14" fill="var(--lane-give)" rx="2" />
        <text x="60" y="228">Giving</text>
        <text x="60" y="242" fill="var(--fg-muted)" fontSize="10">312 people</text>

        <rect x="40" y="254" width="14" height="10" fill="var(--lane-outr)" rx="2" />
        <text x="60" y="262">Outreach</text>
        <text x="60" y="276" fill="var(--fg-muted)" fontSize="10">134 people</text>

        {/* DESTINATION column */}
        <rect x="640" y="14" width="14" height="34" fill="var(--lane-comm)" rx="2" />
        <text x="630" y="29" textAnchor="end">Community</text>
        <text x="630" y="43" textAnchor="end" fill="var(--fg-muted)" fontSize="10">186 next-step</text>

        <rect x="640" y="68" width="14" height="28" fill="var(--lane-serv)" rx="2" />
        <text x="630" y="81" textAnchor="end">Serve</text>
        <text x="630" y="95" textAnchor="end" fill="var(--fg-muted)" fontSize="10">142 next-step</text>

        <rect x="640" y="116" width="14" height="22" fill="var(--lane-wors)" rx="2" />
        <text x="630" y="127" textAnchor="end">Worship</text>
        <text x="630" y="141" textAnchor="end" fill="var(--fg-muted)" fontSize="10">19 returns</text>

        <rect x="640" y="158" width="14" height="20" fill="var(--lane-give)" rx="2" />
        <text x="630" y="169" textAnchor="end">Giving</text>
        <text x="630" y="183" textAnchor="end" fill="var(--fg-muted)" fontSize="10">98 next-step</text>

        <rect x="640" y="200" width="14" height="14" fill="var(--lane-outr)" rx="2" />
        <text x="630" y="211" textAnchor="end">Outreach</text>
        <text x="630" y="225" textAnchor="end" fill="var(--fg-muted)" fontSize="10">61 next-step</text>

        <rect x="640" y="232" width="14" height="40" fill="var(--lane-none)" rx="2" />
        <text x="630" y="247" textAnchor="end">No activity</text>
        <text x="630" y="261" textAnchor="end" fill="var(--fg-muted)" fontSize="10">40 fading off all lanes</text>
      </g>

      {/* No activity → first lane (newcomer entry) */}
      <path d="M54 24 C 250 30, 450 50, 640 56" fill="none" stroke="var(--lane-none)" strokeOpacity="0.45" strokeWidth="14" />
      <path d="M54 28 C 250 35, 450 80, 640 124" fill="none" stroke="var(--lane-none)" strokeOpacity="0.45" strokeWidth="6" />
      <path d="M54 32 C 250 60, 450 100, 640 169" fill="none" stroke="var(--lane-none)" strokeOpacity="0.45" strokeWidth="4" />

      {/* Worship → various */}
      <path d="M54 76 C 250 50, 450 30, 640 25" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="22" />
      <path d="M54 80 C 250 80, 450 80, 640 80" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="14" />
      <path d="M54 84 C 250 110, 450 130, 640 168" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="9" />
      <path d="M54 88 C 250 160, 450 200, 640 207" fill="none" stroke="var(--lane-wors)" strokeOpacity="0.35" strokeWidth="6" />
      <path d="M54 92 C 250 240, 450 250, 640 252" fill="none" stroke="var(--lane-none)" strokeOpacity="0.35" strokeWidth="14" />

      {/* Community → */}
      <path d="M54 130 C 250 50, 450 35, 640 27" fill="none" stroke="var(--lane-comm)" strokeOpacity="0.35" strokeWidth="9" />
      <path d="M54 134 C 250 90, 450 85, 640 82" fill="none" stroke="var(--lane-comm)" strokeOpacity="0.35" strokeWidth="13" />
      <path d="M54 138 C 250 140, 450 130, 640 124" fill="none" stroke="var(--lane-comm)" strokeOpacity="0.35" strokeWidth="6" />
      <path d="M54 142 C 250 180, 450 190, 640 168" fill="none" stroke="var(--lane-comm)" strokeOpacity="0.35" strokeWidth="6" />
      <path d="M54 146 C 250 240, 450 250, 640 256" fill="none" stroke="var(--lane-none)" strokeOpacity="0.35" strokeWidth="6" />

      {/* Serve → */}
      <path d="M54 180 C 250 60, 450 70, 640 80" fill="none" stroke="var(--lane-serv)" strokeOpacity="0.35" strokeWidth="9" />
      <path d="M54 184 C 250 110, 450 110, 640 122" fill="none" stroke="var(--lane-serv)" strokeOpacity="0.35" strokeWidth="6" />
      <path d="M54 188 C 250 170, 450 165, 640 167" fill="none" stroke="var(--lane-serv)" strokeOpacity="0.35" strokeWidth="9" />
      <path d="M54 192 C 250 220, 450 220, 640 211" fill="none" stroke="var(--lane-serv)" strokeOpacity="0.35" strokeWidth="5" />
      <path d="M54 196 C 250 250, 450 255, 640 260" fill="none" stroke="var(--lane-none)" strokeOpacity="0.35" strokeWidth="4" />

      {/* Giving → mostly stays + a bit fades */}
      <path d="M54 222 C 250 215, 450 213, 640 213" fill="none" stroke="var(--lane-give)" strokeOpacity="0.35" strokeWidth="4" />
      <path d="M54 226 C 250 240, 450 250, 640 263" fill="none" stroke="var(--lane-none)" strokeOpacity="0.35" strokeWidth="3" />

      {/* Outreach → mostly stays */}
      <path d="M54 258 C 250 230, 450 218, 640 214" fill="none" stroke="var(--lane-outr)" strokeOpacity="0.35" strokeWidth="3" />
      <path d="M54 262 C 250 255, 450 260, 640 268" fill="none" stroke="var(--lane-none)" strokeOpacity="0.35" strokeWidth="3" />

      <text x="350" y="355" textAnchor="middle" fill="var(--fg-muted)" fontSize="11">
        Newcomers enter from &quot;No activity&quot; · drift back to &quot;No activity&quot; when all lanes fall away.
      </text>
    </svg>
  );
}
