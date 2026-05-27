import type {
  LaneCategory,
  LaneTransitionSummary,
} from "@/lib/dashboard-refresh";

const CATEGORY_LABEL: Record<LaneCategory, string> = {
  comm: "Community",
  serv: "Serving",
  both: "Both",
  none: "No activity",
};

const CATEGORY_COLOR: Record<LaneCategory, string> = {
  comm: "var(--lane-comm, #7c3aed)",
  serv: "var(--lane-serv, #16a34a)",
  both: "var(--accent)",
  none: "var(--fg-subtle, #94a3b8)",
};

const CATEGORY_ORDER: LaneCategory[] = ["both", "comm", "serv", "none"];

function sortedTransitions(
  flow: LaneTransitionSummary,
): LaneTransitionSummary["transitions"] {
  return [...flow.transitions].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.from);
    const bi = CATEGORY_ORDER.indexOf(b.from);
    if (ai !== bi) return ai - bi;
    return CATEGORY_ORDER.indexOf(a.to) - CATEGORY_ORDER.indexOf(b.to);
  });
}

/** Aggregated transition sankey. Each ribbon represents one
 *  (from_state → to_state) transition counted across every person's
 *  full lane chronology — so a single person who went
 *    none → comm → both → serv → none
 *  contributes four separate transition counts (one per arrow).
 *
 *  The same four states (none / comm / serv / both) appear on BOTH
 *  sides because a state is both a destination of past transitions
 *  and a source of future ones — comm on the left = "transitions
 *  OUT of comm", comm on the right = "transitions INTO comm".
 *
 *  Ribbons carry both:
 *   - a hover <title> tooltip with the full label + count
 *   - an inline numeric label rendered when the ribbon is thick
 *     enough to fit one without colliding with neighbors */
export function LaneSankey({ flow }: { flow: LaneTransitionSummary }) {
  if (flow.total === 0) {
    return (
      <p className="text-sm text-muted text-center py-8">
        No lane transitions recorded yet — run a PCO sync or hit
        refresh on home to populate.
      </p>
    );
  }

  const width = 880;
  const height = 480;
  const colW = 16;
  const padX = 12;
  const padTop = 32;
  const padBottom = 36;
  const gap = 18;
  const innerH = height - padTop - padBottom;
  const MIN_LABEL_H = 18;
  const MIN_RIBBON_LABEL_H = 12;

  const leftX = padX + 150;
  const rightX = width - padX - 150 - colW;

  function buildColumn(
    totals: Record<LaneCategory, number>,
  ): Record<LaneCategory, { y: number; h: number } | null> {
    const present = CATEGORY_ORDER.filter((c) => totals[c] > 0);
    const totalGap = Math.max(0, present.length - 1) * gap;
    const stackTotal = present.reduce((s, c) => s + totals[c], 0);
    const availableH = innerH - totalGap;
    const result: Record<LaneCategory, { y: number; h: number } | null> = {
      comm: null,
      serv: null,
      both: null,
      none: null,
    };
    let cursor = padTop;
    for (const c of present) {
      const h = (totals[c] / stackTotal) * availableH;
      result[c] = { y: cursor, h };
      cursor += h + gap;
    }
    return result;
  }

  const leftRects = buildColumn(flow.fromTotals);
  const rightRects = buildColumn(flow.toTotals);

  const transitions = sortedTransitions(flow);
  const cursorsLeft: Record<LaneCategory, number> = {
    comm: 0,
    serv: 0,
    both: 0,
    none: 0,
  };
  const cursorsRight: Record<LaneCategory, number> = {
    comm: 0,
    serv: 0,
    both: 0,
    none: 0,
  };
  const drawn: Array<{
    fromY: number;
    toY: number;
    h: number;
    color: string;
    count: number;
    label: string;
  }> = [];
  for (const t of transitions) {
    const lr = leftRects[t.from];
    const rr = rightRects[t.to];
    if (!lr || !rr) continue;
    const leftSliceH = (t.count / flow.fromTotals[t.from]) * lr.h;
    const rightSliceH = (t.count / flow.toTotals[t.to]) * rr.h;
    const fromY = lr.y + cursorsLeft[t.from] + leftSliceH / 2;
    const toY = rr.y + cursorsRight[t.to] + rightSliceH / 2;
    cursorsLeft[t.from] += leftSliceH;
    cursorsRight[t.to] += rightSliceH;
    const h = (leftSliceH + rightSliceH) / 2;
    drawn.push({
      fromY,
      toY,
      h,
      color: CATEGORY_COLOR[t.from],
      count: t.count,
      label: `${CATEGORY_LABEL[t.from]} → ${CATEGORY_LABEL[t.to]}`,
    });
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full block"
        style={{ height: `${height}px` }}
      >
        {/* Column header labels */}
        <text
          x={leftX + colW / 2}
          y={padTop - 12}
          textAnchor="middle"
          fontSize={10}
          fill="var(--fg-muted, #7c879c)"
        >
          Transitions OUT of
        </text>
        <text
          x={rightX + colW / 2}
          y={padTop - 12}
          textAnchor="middle"
          fontSize={10}
          fill="var(--fg-muted, #7c879c)"
        >
          Transitions INTO
        </text>

        {/* Flow ribbons FIRST so the rect strokes sit on top. */}
        {drawn.map((d, i) => {
          const x1 = leftX + colW;
          const x2 = rightX;
          const midX = (x1 + x2) / 2;
          const path = `M ${x1} ${d.fromY} C ${midX} ${d.fromY}, ${midX} ${d.toY}, ${x2} ${d.toY}`;
          return (
            <path
              key={i}
              d={path}
              stroke={d.color}
              strokeOpacity={0.35}
              strokeWidth={Math.max(1.5, d.h)}
              fill="none"
            >
              <title>
                {d.label} · {d.count.toLocaleString()}
              </title>
            </path>
          );
        })}

        {/* Ribbon count labels — only on ribbons thick enough to host
            text without colliding with neighbors. */}
        {drawn.map((d, i) => {
          if (d.h < MIN_RIBBON_LABEL_H) return null;
          const x1 = leftX + colW;
          const x2 = rightX;
          const midX = (x1 + x2) / 2;
          const midY = (d.fromY + d.toY) / 2;
          return (
            <g key={`lbl-${i}`} pointerEvents="none">
              <rect
                x={midX - 22}
                y={midY - 9}
                width={44}
                height={16}
                rx={3}
                fill="var(--bg-elev)"
                fillOpacity={0.85}
                stroke={d.color}
                strokeOpacity={0.5}
                strokeWidth={0.5}
              />
              <text
                x={midX}
                y={midY + 3}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="var(--fg)"
              >
                {d.count.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Left column rects + labels */}
        {CATEGORY_ORDER.map((c) => {
          const r = leftRects[c];
          if (!r) return null;
          const showText = r.h >= MIN_LABEL_H;
          return (
            <g key={`L-${c}`}>
              <rect
                x={leftX}
                y={r.y}
                width={colW}
                height={r.h}
                fill={CATEGORY_COLOR[c]}
                rx={2}
              >
                <title>
                  Out of {CATEGORY_LABEL[c]} ·{" "}
                  {flow.fromTotals[c].toLocaleString()} transitions
                </title>
              </rect>
              {showText && (
                <text
                  x={leftX - 8}
                  y={r.y + r.h / 2 + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--fg)"
                >
                  <tspan fontWeight={500}>{CATEGORY_LABEL[c]}</tspan>
                  <tspan
                    dx={6}
                    fill="var(--fg-muted, #7c879c)"
                    fontSize={10}
                  >
                    {flow.fromTotals[c].toLocaleString()}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}

        {/* Right column rects + labels */}
        {CATEGORY_ORDER.map((c) => {
          const r = rightRects[c];
          if (!r) return null;
          const showText = r.h >= MIN_LABEL_H;
          return (
            <g key={`R-${c}`}>
              <rect
                x={rightX}
                y={r.y}
                width={colW}
                height={r.h}
                fill={CATEGORY_COLOR[c]}
                rx={2}
              >
                <title>
                  Into {CATEGORY_LABEL[c]} ·{" "}
                  {flow.toTotals[c].toLocaleString()} transitions
                </title>
              </rect>
              {showText && (
                <text
                  x={rightX + colW + 8}
                  y={r.y + r.h / 2 + 4}
                  textAnchor="start"
                  fontSize={11}
                  fill="var(--fg)"
                >
                  <tspan fontWeight={500}>{CATEGORY_LABEL[c]}</tspan>
                  <tspan
                    dx={6}
                    fill="var(--fg-muted, #7c879c)"
                    fontSize={10}
                  >
                    {flow.toTotals[c].toLocaleString()}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}

        <text
          x={width / 2}
          y={height - 10}
          textAnchor="middle"
          fontSize={10}
          fill="var(--fg-muted, #7c879c)"
        >
          {flow.total.toLocaleString()} lane-state transitions total ·
          every group / team join + leave across every person&apos;s
          chronology
        </text>
      </svg>

      <TransitionCallouts flow={flow} />
    </div>
  );
}

function TransitionCallouts({ flow }: { flow: LaneTransitionSummary }) {
  const find = (from: LaneCategory, to: LaneCategory) =>
    flow.transitions.find((f) => f.from === from && f.to === to)?.count ?? 0;

  // On-ramps: someone moving INTO an engaged state (comm, serv, both)
  // from a less-engaged one. Net positive movement.
  const onramps =
    find("none", "comm") +
    find("none", "serv") +
    find("none", "both") +
    find("comm", "both") +
    find("serv", "both");
  // Drops: someone moving FROM an engaged state to a less-engaged one.
  const drops =
    find("comm", "none") +
    find("serv", "none") +
    find("both", "none") +
    find("both", "comm") +
    find("both", "serv");
  // Cross-lane swaps: comm ↔ serv directly (lost one lane, joined the
  // other in the same step — rare and worth noticing).
  const swaps = find("comm", "serv") + find("serv", "comm");

  const items: Array<{ label: string; count: number; tone: Tone }> = (
    [
      {
        label: "On-ramps (moved INTO an engaged lane)",
        count: onramps,
        tone: "good" as Tone,
      },
      {
        label: "Drops (moved OUT of an engaged lane)",
        count: drops,
        tone: (drops > onramps ? "warn" : "muted") as Tone,
      },
      {
        label: "Lane swaps (left one, joined another directly)",
        count: swaps,
        tone: "accent" as Tone,
      },
    ] satisfies Array<{ label: string; count: number; tone: Tone }>
  ).filter((i) => i.count > 0);

  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded border border-border-soft px-3 py-2 text-xs flex justify-between gap-3 bg-bg-elev-2/40"
        >
          <span className="text-muted">{it.label}</span>
          <span className={`tnum font-medium ${TONE_CLASS[it.tone]}`}>
            {it.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Companion compact view to the sankey — a 4x4 transition matrix.
 *  Each cell is one (from → to) count, sized by share of the from-row
 *  total. Useful when the sankey ribbons get visually busy: the
 *  matrix makes it instant to spot "comm → both" (biggest on-ramp)
 *  vs "both → comm" (community-only drift). */
export function LaneTransitionMatrix({
  flow,
}: {
  flow: LaneTransitionSummary;
}) {
  if (flow.total === 0) return null;
  const states: LaneCategory[] = ["none", "comm", "serv", "both"];
  const find = (from: LaneCategory, to: LaneCategory) =>
    flow.transitions.find((f) => f.from === from && f.to === to)?.count ?? 0;
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left text-muted font-medium pr-3 pb-2">
              From ↓ · To →
            </th>
            {states.map((to) => (
              <th
                key={to}
                className="text-center text-fg font-medium px-2 pb-2"
              >
                {CATEGORY_LABEL[to]}
              </th>
            ))}
            <th className="text-right text-muted font-medium pl-3 pb-2">
              Total out
            </th>
          </tr>
        </thead>
        <tbody>
          {states.map((from) => {
            const rowTotal = flow.fromTotals[from];
            return (
              <tr
                key={from}
                className="border-t border-border-softer"
              >
                <td className="pr-3 py-2 text-fg font-medium">
                  {CATEGORY_LABEL[from]}
                </td>
                {states.map((to) => {
                  if (from === to) {
                    return (
                      <td
                        key={to}
                        className="px-2 py-2 text-center text-subtle"
                      >
                        —
                      </td>
                    );
                  }
                  const count = find(from, to);
                  const pct = rowTotal > 0 ? (count / rowTotal) * 100 : 0;
                  const intensity = Math.min(1, pct / 50); // 50%+ saturates
                  return (
                    <td
                      key={to}
                      className="px-2 py-2 text-center tnum"
                      style={{
                        background: count > 0
                          ? `color-mix(in oklab, ${CATEGORY_COLOR[from]} ${
                              Math.round(intensity * 35)
                            }%, transparent)`
                          : "transparent",
                      }}
                      title={`${CATEGORY_LABEL[from]} → ${CATEGORY_LABEL[to]}: ${count.toLocaleString()} (${pct.toFixed(0)}% of out-flow)`}
                    >
                      {count.toLocaleString()}
                    </td>
                  );
                })}
                <td className="pl-3 py-2 text-right text-muted tnum">
                  {rowTotal.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Tone = "good" | "warn" | "muted" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  good: "text-good-soft-fg",
  warn: "text-warn-soft-fg",
  muted: "text-muted",
  accent: "text-accent",
};
