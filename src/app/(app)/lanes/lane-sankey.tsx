import type { LaneCategory, LaneFlow } from "@/lib/dashboard-refresh";

const CATEGORY_LABEL: Record<LaneCategory, string> = {
  comm: "Community",
  serv: "Serving",
  both: "Both",
  none: "No activity",
};

/** CSS var name (kept consistent with the rest of the lane palette
 *  used in LaneTag). Both becomes a neutral fg color so it doesn't
 *  visually compete with either source lane. */
const CATEGORY_COLOR: Record<LaneCategory, string> = {
  comm: "var(--lane-comm, #7c3aed)",
  serv: "var(--lane-serv, #16a34a)",
  both: "var(--accent)",
  none: "var(--fg-subtle, #94a3b8)",
};

const CATEGORY_ORDER: LaneCategory[] = ["both", "comm", "serv", "none"];

/** Order flows so the curves stack predictably top-to-bottom — heaviest
 *  outflow first on the left, heaviest inflow first on the right. */
function sortedFlows(flow: LaneFlow): LaneFlow["flows"] {
  return [...flow.flows].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.from);
    const bi = CATEGORY_ORDER.indexOf(b.from);
    if (ai !== bi) return ai - bi;
    return CATEGORY_ORDER.indexOf(a.to) - CATEGORY_ORDER.indexOf(b.to);
  });
}

/** Single-pass sankey: each person's "first lane entered" on the left,
 *  "current lane" on the right. Heights are proportional to the count
 *  in each bucket. Designed for two columns — anything richer (e.g. a
 *  middle "ever in both" step) can come later once we have the right
 *  data. */
export function LaneSankey({ flow }: { flow: LaneFlow }) {
  if (flow.total === 0) {
    return (
      <p className="text-sm text-muted text-center py-8">
        No people in the snapshot yet — run a PCO sync (or hit refresh
        on home) to populate.
      </p>
    );
  }

  const width = 760;
  const height = 380;
  const colW = 14;
  const padX = 12;
  const padTop = 24;
  const padBottom = 28;
  const gap = 10; // vertical gap between stacked rects in the same column
  const innerH = height - padTop - padBottom;

  const leftX = padX + 80;
  const rightX = width - padX - 80 - colW;

  // Compute rect geometry for each column. The "free" vertical space
  // (innerH minus the gaps) is distributed proportional to each
  // category's share.
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

  // For each flow, record the slice of its source rect and dest rect
  // it occupies (stacked in the same CATEGORY_ORDER so curves don't
  // cross within a bucket).
  const flows = sortedFlows(flow);
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
  for (const f of flows) {
    const lr = leftRects[f.from];
    const rr = rightRects[f.to];
    if (!lr || !rr) continue;
    const leftSliceH = (f.count / flow.fromTotals[f.from]) * lr.h;
    const rightSliceH = (f.count / flow.toTotals[f.to]) * rr.h;
    const fromY = lr.y + cursorsLeft[f.from] + leftSliceH / 2;
    const toY = rr.y + cursorsRight[f.to] + rightSliceH / 2;
    cursorsLeft[f.from] += leftSliceH;
    cursorsRight[f.to] += rightSliceH;
    // The visual thickness of the curve = average of the two slice
    // heights, so a flow that's a big chunk of its source but a tiny
    // chunk of its dest tapers naturally.
    const h = (leftSliceH + rightSliceH) / 2;
    drawn.push({
      fromY,
      toY,
      h,
      color: CATEGORY_COLOR[f.from],
      count: f.count,
      label: `${CATEGORY_LABEL[f.from]} → ${CATEGORY_LABEL[f.to]}`,
    });
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full block"
        style={{ height: `${height}px` }}
      >
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
              strokeOpacity={0.32}
              strokeWidth={Math.max(1.5, d.h)}
              fill="none"
            >
              <title>
                {d.label} · {d.count.toLocaleString()}
              </title>
            </path>
          );
        })}

        {/* Left column rects + labels */}
        {CATEGORY_ORDER.map((c) => {
          const r = leftRects[c];
          if (!r) return null;
          return (
            <g key={`L-${c}`}>
              <rect
                x={leftX}
                y={r.y}
                width={colW}
                height={r.h}
                fill={CATEGORY_COLOR[c]}
                rx={2}
              />
              <text
                x={leftX - 6}
                y={r.y + 12}
                textAnchor="end"
                fontSize={11}
                fill="var(--fg)"
              >
                {CATEGORY_LABEL[c]}
              </text>
              <text
                x={leftX - 6}
                y={r.y + 24}
                textAnchor="end"
                fontSize={10}
                fill="var(--fg-muted, #7c879c)"
              >
                {flow.fromTotals[c].toLocaleString()} entered first
              </text>
            </g>
          );
        })}

        {/* Right column rects + labels */}
        {CATEGORY_ORDER.map((c) => {
          const r = rightRects[c];
          if (!r) return null;
          return (
            <g key={`R-${c}`}>
              <rect
                x={rightX}
                y={r.y}
                width={colW}
                height={r.h}
                fill={CATEGORY_COLOR[c]}
                rx={2}
              />
              <text
                x={rightX + colW + 6}
                y={r.y + 12}
                textAnchor="start"
                fontSize={11}
                fill="var(--fg)"
              >
                {CATEGORY_LABEL[c]}
              </text>
              <text
                x={rightX + colW + 6}
                y={r.y + 24}
                textAnchor="start"
                fontSize={10}
                fill="var(--fg-muted, #7c879c)"
              >
                {flow.toTotals[c].toLocaleString()} today
              </text>
            </g>
          );
        })}

        <text
          x={leftX + colW / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize={10}
          fill="var(--fg-muted, #7c879c)"
        >
          First lane entered (any time)
        </text>
        <text
          x={rightX + colW / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize={10}
          fill="var(--fg-muted, #7c879c)"
        >
          Currently in
        </text>
      </svg>

      {/* Highlight rows for the most interesting flows. */}
      <FlowCallouts flow={flow} />
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

function FlowCallouts({ flow }: { flow: LaneFlow }) {
  // Helper to find a flow by from + to.
  const find = (from: LaneCategory, to: LaneCategory) =>
    flow.flows.find((f) => f.from === from && f.to === to)?.count ?? 0;

  const items: Array<{ label: string; count: number; tone: Tone }> = [];
  // Healthy onramp: started in serving / community → now in both.
  const servToBoth = find("serv", "both");
  const commToBoth = find("comm", "both");
  if (servToBoth + commToBoth > 0) {
    items.push({
      label: "Added the other lane after entering",
      count: servToBoth + commToBoth,
      tone: "good",
    });
  }
  // Drifted out of both lanes.
  const drift =
    find("comm", "none") + find("serv", "none") + find("both", "none");
  if (drift > 0) {
    items.push({
      label: "Was active in a lane, now in none",
      count: drift,
      tone: "warn",
    });
  }
  // Stuck in one lane only.
  const stuckComm = find("comm", "comm");
  const stuckServ = find("serv", "serv");
  if (stuckComm > 0) {
    items.push({
      label: "Community only — never moved to serving",
      count: stuckComm,
      tone: "muted",
    });
  }
  if (stuckServ > 0) {
    items.push({
      label: "Serving only — never joined a group",
      count: stuckServ,
      tone: "muted",
    });
  }
  // Stayed in both.
  const heldBoth = find("both", "both");
  if (heldBoth > 0) {
    items.push({
      label: "Entered both lanes together and stayed",
      count: heldBoth,
      tone: "accent",
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
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
