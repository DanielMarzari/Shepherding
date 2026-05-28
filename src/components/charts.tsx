"use client";

import { useState, type ReactNode } from "react";

/** Deterministic thousands-grouping formatter — produces the same
 *  output server-side and client-side regardless of locale. We can't
 *  use Number.prototype.toLocaleString() in client components because
 *  Node and the browser default to different locales, and the
 *  resulting string mismatch triggers React hydration error #418.
 *  This regex-based grouping always emits ASCII commas. */
function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Shared chart palette — stable accent + 5 distinct hues rotating around
 *  the wheel so adjacent slices/bars stay distinguishable. */
const PALETTE = [
  "var(--accent)",
  "var(--good-soft-fg)",
  "var(--warn-soft-fg)",
  "var(--bad-soft-fg)",
  "var(--lane-comm, #7c3aed)",
  "var(--lane-care, #f59e0b)",
  "var(--muted)",
];

export interface ChartDatum {
  label: string;
  count: number;
  /** Optional override for slice / bar color. When unset, the chart
   *  picks from PALETTE by index. Use this when the categories have
   *  meaning attached to specific colors (e.g. Shepherded = green,
   *  Active = yellow, Present = grey on the home people-mix pie). */
  color?: string;
  /** Optional minors-only sub-count. When >0, the pie legend renders
   *  the row as "{adults} + {kids} kids ({pct}%)" with the adults
   *  count = `count - kids`. */
  kids?: number;
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <div className="rounded-xl border border-border-soft bg-bg-elev p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold">{title}</div>
        {subtitle && (
          <div className="text-xs text-muted mt-0.5">{subtitle}</div>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Tooltip (shared) ──────────────────────────────────────────────────

/** SVG tooltip that auto-flips below the point if it would clip off the
 *  top of the chart, and clamps horizontally to stay inside `viewWidth`. */
function Tooltip({
  x,
  y,
  text,
  viewWidth,
  topPad = 4,
}: {
  x: number;
  y: number;
  text: string;
  /** Total SVG viewBox width — used to clamp the tooltip so it never
   *  hangs off the left/right edge. */
  viewWidth: number;
  /** Minimum Y at which the tooltip can sit. If `y - h - 6` would land
   *  above this, the tooltip flips to BELOW the point instead. */
  topPad?: number;
}) {
  const w = Math.max(40, text.length * 6.5 + 12);
  const h = 20;
  const wantAboveY = y - h - 6;
  const flipBelow = wantAboveY < topPad;
  const boxY = flipBelow ? y + 8 : wantAboveY;
  // Clamp x so the box doesn't run off either side of the viewBox.
  const boxX = Math.max(2, Math.min(viewWidth - w - 2, x - w / 2));
  return (
    <g pointerEvents="none">
      <rect
        x={boxX}
        y={boxY}
        width={w}
        height={h}
        rx={4}
        fill="#0f172a"
        fillOpacity="0.92"
      />
      <text
        x={boxX + w / 2}
        y={boxY + 13}
        textAnchor="middle"
        fontSize="10"
        fontWeight="500"
        fill="#ffffff"
      >
        {text}
      </text>
    </g>
  );
}

// ─── Pie (donut) ───────────────────────────────────────────────────────

export function PieChart({
  data,
  maxSlices = 6,
  preserveOrder = false,
}: {
  data: ChartDatum[];
  maxSlices?: number;
  /** When true the slices render in the order the caller provided
   *  them. Default behavior sorts by count desc so the largest slice
   *  starts at 12-o'clock — but for ordered categories (Shepherded →
   *  Active → Present), the caller's order is what the user expects. */
  preserveOrder?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return <div className="text-xs text-muted py-6 text-center">No data</div>;
  }
  const sorted = preserveOrder
    ? [...data]
    : [...data].sort((a, b) => b.count - a.count);
  const visible = sorted.slice(0, maxSlices - 1);
  const restCount = sorted
    .slice(maxSlices - 1)
    .reduce((s, d) => s + d.count, 0);
  const slices = restCount > 0
    ? [...visible, { label: "Other", count: restCount }]
    : visible;

  // SVG params
  const size = 180;
  const r = 70;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 42;

  let angle = -Math.PI / 2;
  const paths: Array<{
    d: string;
    color: string;
    label: string;
    count: number;
    pct: number;
    mid: { x: number; y: number };
  }> = [];
  function colorFor(slice: ChartDatum, i: number): string {
    return slice.color ?? PALETTE[i % PALETTE.length];
  }
  slices.forEach((slice, i) => {
    const pct = slice.count / total;
    const sweep = pct * Math.PI * 2;
    const next = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(next) * r;
    const y2 = cy + Math.sin(next) * r;
    const xi1 = cx + Math.cos(angle) * innerR;
    const yi1 = cy + Math.sin(angle) * innerR;
    const xi2 = cx + Math.cos(next) * innerR;
    const yi2 = cy + Math.sin(next) * innerR;
    const midAngle = (angle + next) / 2;
    const midR = (r + innerR) / 2;
    paths.push({
      d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${innerR} ${innerR} 0 ${large} 0 ${xi1} ${yi1} Z`,
      color: colorFor(slice, i),
      label: slice.label,
      count: slice.count,
      pct,
      mid: {
        x: cx + Math.cos(midAngle) * midR,
        y: cy + Math.sin(midAngle) * midR,
      },
    });
    angle = next;
  });

  const hovered = hoverIdx != null ? paths[hoverIdx] : null;

  return (
    <div>
      <div className="flex justify-center mb-3">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Pie chart"
        >
          {paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill={p.color}
              stroke="var(--bg-elev)"
              strokeWidth="1.5"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                opacity: hoverIdx == null || hoverIdx === i ? 1 : 0.55,
                transition: "opacity 120ms",
                cursor: "pointer",
              }}
            />
          ))}
          <text
            x={cx}
            y={cy + 2}
            textAnchor="middle"
            fontSize="14"
            fontWeight="600"
            fill="var(--fg)"
          >
            {total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </text>
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            fontSize="9"
            fill="var(--muted)"
          >
            total
          </text>
          {hovered && (
            <Tooltip
              x={hovered.mid.x}
              y={hovered.mid.y}
              viewWidth={size}
              text={`${hovered.label}: ${hovered.count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} (${Math.round(hovered.pct * 100)}%)`}
            />
          )}
        </svg>
      </div>
      <ul className="space-y-1 text-xs">
        {slices.map((s, i) => {
          const pct = (s.count / total) * 100;
          return (
            <li
              key={s.label}
              className="flex items-center gap-2"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: colorFor(s, i) }}
              />
              <span
                className="text-fg flex-1 break-words"
                title={s.label}
              >
                {s.label}
              </span>
              <span className="tnum text-muted shrink-0">
                {s.kids != null && s.kids > 0 ? (
                  <>
                    {(s.count - s.kids).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                    <span className="text-subtle">
                      {" + "}
                      {s.kids.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} kids
                    </span>{" "}
                  </>
                ) : (
                  <>{s.count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} </>
                )}
                <span className="text-subtle">({Math.round(pct)}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Bar (vertical) ────────────────────────────────────────────────────

/** Vertical bar chart for small categorical data. Counts render BELOW the
 *  bar so they never overlap the card subtitle above the chart. */
export function BarChart({ data }: { data: ChartDatum[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return <div className="text-xs text-muted py-6 text-center">No data</div>;
  }
  const max = Math.max(...data.map((d) => d.count));
  const height = 110;
  return (
    <div className="h-[200px] flex flex-col">
      <div className="flex-1 flex items-end justify-around gap-3 px-1">
        {data.map((d, i) => {
          const barH = max > 0 ? (d.count / max) * height : 0;
          const pct = total > 0 ? (d.count / total) * 100 : 0;
          const isHovered = hoverIdx === i;
          return (
            <div
              key={d.label}
              className="flex flex-col items-center gap-0.5 flex-1 min-w-0"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {isHovered ? (
                <div
                  className="text-[10px] tnum font-medium px-1.5 py-0.5 rounded"
                  style={{ background: "#0f172a", color: "#ffffff" }}
                >
                  {d.count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} · {Math.round(pct)}%
                </div>
              ) : (
                <div className="text-[10px] tnum text-subtle invisible">·</div>
              )}
              <div
                className="w-full max-w-[60px] rounded-t transition-all"
                style={{
                  height: `${barH}px`,
                  background: PALETTE[i % PALETTE.length],
                  opacity: hoverIdx == null || isHovered ? 1 : 0.55,
                  cursor: "pointer",
                }}
                role="presentation"
              />
            </div>
          );
        })}
      </div>
      {/* Labels + counts BELOW the chart so they never collide with the
         card subtitle. */}
      <div className="flex justify-around gap-3 px-1 pt-2 border-t border-border-softer mt-1">
        {data.map((d) => (
          <div
            key={d.label}
            className="flex flex-col items-center flex-1 min-w-0"
          >
            <div className="text-xs tnum font-medium text-fg">
              {d.count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
            </div>
            <div className="text-[10px] text-muted text-center truncate w-full">
              {d.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Distribution curve (smooth area) ─────────────────────────────────

export function DistributionCurve({ data }: { data: ChartDatum[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const known = data.filter((d) => d.label !== "Unknown");
  const unknown = data.find((d) => d.label === "Unknown")?.count ?? 0;
  const total = known.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return <div className="text-xs text-muted py-6 text-center">No data</div>;
  }

  const width = 380;
  const height = 140;
  const padX = 24;
  const padY = 10;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const max = Math.max(...known.map((d) => d.count));

  const points = known.map((d, i) => {
    const x = padX + (i / Math.max(1, known.length - 1)) * innerW;
    const y = padY + innerH - (d.count / max) * innerH;
    return { x, y, d };
  });

  let path = `M ${points[0].x} ${padY + innerH}`;
  path += ` L ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    path += ` Q ${p0.x} ${p0.y}, ${mx} ${my}`;
  }
  path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
  path += ` L ${points[points.length - 1].x} ${padY + innerH} Z`;

  const hovered = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Distribution curve"
      >
        <path
          d={path}
          fill="var(--accent)"
          fillOpacity="0.18"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        {points.map((p, i) => (
          <g key={p.d.label}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hoverIdx === i ? 4.5 : 2.5}
              fill="var(--accent)"
              style={{ transition: "r 100ms" }}
            />
            {/* Invisible larger hit target for easier hover. */}
            <rect
              x={p.x - 12}
              y={padY}
              width={24}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: "pointer" }}
            />
          </g>
        ))}
        {hovered && (
          <Tooltip
            x={hovered.x}
            y={hovered.y}
            viewWidth={width}
            text={`${hovered.d.label}: ${hovered.d.count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`}
          />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-subtle tnum mt-1">
        {known.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
      {unknown > 0 && (
        <div className="text-[10px] text-subtle mt-1">
          {unknown.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} unknown (no birthdate on file)
        </div>
      )}
    </div>
  );
}

// ─── Multi-line time series (% of cohort) ─────────────────────────────

export interface MultiLineSeries {
  label: string;
  /** Numerator at each x-point (e.g. how many people of this group attended in month X). */
  values: number[];
  /** Optional denominator at each x-point. When present, the line plots
   *  values/cohortSize × 100. Pass a single number to apply across all x. */
  cohortSize?: number | number[];
}

export function MultiLineChart({
  series,
  xLabels,
  yMode = "count",
  height = 200,
}: {
  series: MultiLineSeries[];
  xLabels: string[];
  yMode?: "count" | "percent";
  height?: number;
}) {
  const [hover, setHover] = useState<{
    seriesIdx: number;
    pointIdx: number;
  } | null>(null);

  // Resolve each series to its plot values + denominators.
  const resolved = series.map((s) => {
    const denom: number[] =
      typeof s.cohortSize === "number"
        ? new Array(s.values.length).fill(s.cohortSize)
        : (s.cohortSize ?? new Array(s.values.length).fill(0));
    const plotValues =
      yMode === "percent"
        ? s.values.map((v, i) =>
            denom[i] > 0 ? (v / denom[i]) * 100 : 0,
          )
        : s.values.slice();
    return { ...s, denom, plotValues };
  });

  const flatMax = resolved.reduce(
    (m, s) => Math.max(m, ...s.plotValues),
    0,
  );
  if (flatMax === 0 || xLabels.length === 0) {
    return <div className="text-xs text-muted py-6 text-center">No data</div>;
  }
  // For %, clamp the axis upper bound to 100 if we're below; for count, just use max.
  const yTop = yMode === "percent" ? Math.max(flatMax, 100) : flatMax;
  const width = 600;
  const padX = 38;
  const padTop = 18;
  const padBottom = 28;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const stepX = xLabels.length > 1 ? innerW / (xLabels.length - 1) : innerW;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yTop * f));

  function xFor(j: number): number {
    return padX + j * stepX;
  }
  function yFor(v: number): number {
    return padTop + innerH - (v / yTop) * innerH;
  }
  function pathFor(values: number[]): string {
    return values
      .map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`)
      .join(" ");
  }

  // Snap a mouse position to the nearest (series, point) so a hover on
  // ANY visible line wins, including where lines cross. Hit tests in SVG
  // viewBox units after converting from CSS pixels.
  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    const vy = ((e.clientY - rect.top) / rect.height) * height;
    if (vx < padX - 4 || vx > width - padX + 4) {
      setHover(null);
      return;
    }
    // Column (point index) nearest to vx.
    const pointIdx = Math.max(
      0,
      Math.min(
        xLabels.length - 1,
        Math.round((vx - padX) / stepX),
      ),
    );
    // Among all series, the one whose y at this column is closest to vy.
    let bestSeries = 0;
    let bestDist = Infinity;
    for (let i = 0; i < resolved.length; i++) {
      const y = yFor(resolved[i].plotValues[pointIdx]);
      const dist = Math.abs(y - vy);
      if (dist < bestDist) {
        bestDist = dist;
        bestSeries = i;
      }
    }
    setHover({ seriesIdx: bestSeries, pointIdx });
  }

  const hoveredPoint = (() => {
    if (!hover) return null;
    const s = resolved[hover.seriesIdx];
    return {
      x: xFor(hover.pointIdx),
      y: yFor(s.plotValues[hover.pointIdx]),
      s,
      idx: hover.pointIdx,
    };
  })();

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Trend over time"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: "crosshair" }}
      >
        {yTicks.map((tick, i) => {
          const y = padTop + innerH - (tick / yTop) * innerH;
          return (
            <g key={i}>
              <line
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                stroke="var(--border-soft)"
                strokeDasharray="2 3"
                strokeWidth="0.5"
              />
              <text
                x={padX - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="var(--subtle)"
              >
                {yMode === "percent" ? `${tick}%` : tick.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              </text>
            </g>
          );
        })}
        {xLabels.map((label, i) => {
          if (xLabels.length > 6 && i % 2 !== 0) return null;
          const x = padX + i * stepX;
          return (
            <text
              key={i}
              x={x}
              y={height - padBottom + 14}
              textAnchor="middle"
              fontSize="9"
              fill="var(--subtle)"
            >
              {label}
            </text>
          );
        })}
        {resolved.map((s, i) => (
          <g key={s.label} pointerEvents="none">
            <path
              d={pathFor(s.plotValues)}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth="2"
              strokeLinejoin="round"
              style={{
                opacity: hover == null || hover.seriesIdx === i ? 1 : 0.3,
                transition: "opacity 120ms",
              }}
            />
            {s.plotValues.map((v, j) => (
              <circle
                key={j}
                cx={xFor(j)}
                cy={yFor(v)}
                r={hover?.seriesIdx === i && hover?.pointIdx === j ? 4 : 2}
                fill={PALETTE[i % PALETTE.length]}
                style={{
                  opacity: hover == null || hover.seriesIdx === i ? 1 : 0.3,
                  transition: "r 100ms",
                }}
              />
            ))}
          </g>
        ))}
        {hoveredPoint && (
          <Tooltip
            x={hoveredPoint.x}
            y={hoveredPoint.y}
            viewWidth={width}
            topPad={padTop}
            text={
              yMode === "percent"
                ? `${Math.round(hoveredPoint.s.plotValues[hoveredPoint.idx])}%`
                : `${hoveredPoint.s.values[hoveredPoint.idx].toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`
            }
          />
        )}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mt-1">
        {series.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-0.5 inline-block"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            <span className="text-muted">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Box & whisker ────────────────────────────────────────────────

export interface BoxWhiskerBox {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  count: number;
}

/** Vertical box-and-whisker chart — one box per x-bucket. Used for
 *  pipeline trend lines: each month gets a box showing the spread of
 *  conversion days for that cohort. */
export function BoxWhiskerChart({
  boxes,
  xLabels,
  height,
  yLabelSuffix = "d",
  rotateLabels = false,
}: {
  boxes: Array<BoxWhiskerBox | null>;
  xLabels: string[];
  /** Total SVG height. Defaults are tuned to leave room for rotated x
   *  labels — pass an explicit value only when you need more vertical
   *  room for tall data. */
  height?: number;
  yLabelSuffix?: string;
  /** Rotate x-axis labels -35° so long category names don't overlap.
   *  Adds extra bottom padding to make room. */
  rotateLabels?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const padL = 44;
  const padR = 12;
  const padT = 12;
  // Compute bottom padding from the longest visible label when rotated
  // — a 22-char label at fontSize 10 projects ~75px downward at -35°.
  // Without this the categorical chart gets clipped off the bottom of
  // its card and the bottom row of labels is unreadable.
  const longestVisibleLabel = rotateLabels
    ? xLabels.reduce((m, l) => Math.max(m, Math.min(22, l.length)), 0)
    : 0;
  const padB = rotateLabels
    ? Math.max(60, Math.round(longestVisibleLabel * 6 * 0.57) + 22)
    : 32;
  const resolvedHeight = height ?? (rotateLabels ? 280 : 240);
  const viewBoxW = 900;
  const innerH = resolvedHeight - padT - padB;
  const innerW = viewBoxW - padL - padR;
  const colW = innerW / Math.max(1, boxes.length);
  const maxY = Math.max(
    1,
    ...boxes.flatMap((b) => (b && b.count > 0 ? [b.max] : [0])),
  );
  const yScale = (v: number) => padT + innerH - (v / maxY) * innerH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxY);
  // Show ~10 x-labels max so they don't overlap. With rotation we can
  // fit more, but still cap to keep them legible.
  const labelStride = rotateLabels
    ? Math.max(1, Math.ceil(boxes.length / 20))
    : Math.max(1, Math.ceil(boxes.length / 10));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${viewBoxW} ${resolvedHeight}`}
        className="block w-full"
        style={{ overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={viewBoxW - padR}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="rgba(140,150,170,0.18)"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={yScale(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill="#7c879c"
            >
              {Math.round(v)}
              {yLabelSuffix}
            </text>
          </g>
        ))}
        {boxes.map((b, i) => {
          const cx = padL + colW * (i + 0.5);
          const halfW = Math.max(2, Math.min(8, colW * 0.35));
          if (!b || b.count === 0) {
            // Empty bucket — still draw a tiny baseline dot so the
            // timeline reads as a full 5-year span even when most
            // months have no conversions. Without this, the chart
            // looks like it starts wherever the data starts.
            const baselineY = padT + innerH;
            return (
              <g key={i}>
                <rect
                  x={padL + colW * i}
                  y={padT}
                  width={colW}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
                <circle
                  cx={cx}
                  cy={baselineY}
                  r={1.2}
                  fill="rgba(124,135,156,0.55)"
                  pointerEvents="none"
                />
              </g>
            );
          }
          const isHover = hover === i;
          const stroke = isHover ? "#34d399" : "rgba(168,178,198,0.7)";
          const fill = isHover
            ? "rgba(52,211,153,0.28)"
            : "rgba(168,178,198,0.16)";
          const medianStroke = isHover ? "#34d399" : "#e8ebf2";
          const yMin = yScale(b.min);
          const yMax = yScale(b.max);
          const yP25 = yScale(b.p25);
          const yP75 = yScale(b.p75);
          const yMed = yScale(b.median);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect
                x={padL + colW * i}
                y={padT}
                width={colW}
                height={innerH}
                fill="transparent"
              />
              <line
                x1={cx}
                x2={cx}
                y1={yMax}
                y2={yMin}
                stroke={stroke}
                strokeWidth={1}
              />
              <line
                x1={cx - halfW * 0.55}
                x2={cx + halfW * 0.55}
                y1={yMin}
                y2={yMin}
                stroke={stroke}
                strokeWidth={1}
              />
              <line
                x1={cx - halfW * 0.55}
                x2={cx + halfW * 0.55}
                y1={yMax}
                y2={yMax}
                stroke={stroke}
                strokeWidth={1}
              />
              <rect
                x={cx - halfW}
                y={yP75}
                width={halfW * 2}
                height={Math.max(1, yP25 - yP75)}
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
              />
              <line
                x1={cx - halfW}
                x2={cx + halfW}
                y1={yMed}
                y2={yMed}
                stroke={medianStroke}
                strokeWidth={1.5}
              />
            </g>
          );
        })}
        {xLabels.map((lab, i) => {
          if (i % labelStride !== 0) return null;
          const cx = padL + colW * (i + 0.5);
          const y = resolvedHeight - padB + 14;
          // Truncate long labels — full text still in tooltip on hover.
          const shown = lab.length > 22 ? `${lab.slice(0, 21)}…` : lab;
          if (rotateLabels) {
            return (
              <text
                key={i}
                x={cx}
                y={y}
                textAnchor="end"
                fontSize={10}
                fill="#7c879c"
                transform={`rotate(-35 ${cx} ${y})`}
              >
                {shown}
              </text>
            );
          }
          return (
            <text
              key={i}
              x={cx}
              y={y}
              textAnchor="middle"
              fontSize={10}
              fill="#7c879c"
            >
              {shown}
            </text>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="mt-1 text-xs">
          <span className="font-medium">{xLabels[hover] ?? ""}</span>
          {boxes[hover] && boxes[hover]!.count > 0 ? (
            <span className="text-muted">
              {" "}
              · n={boxes[hover]!.count} · min{" "}
              {Math.round(boxes[hover]!.min)}d · p25{" "}
              {Math.round(boxes[hover]!.p25)}d · median{" "}
              <span className="text-fg">
                {Math.round(boxes[hover]!.median)}d
              </span>{" "}
              · p75 {Math.round(boxes[hover]!.p75)}d · max{" "}
              {Math.round(boxes[hover]!.max)}d
            </span>
          ) : (
            <span className="text-subtle"> · no conversions this month</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Scatter (engagement) ────────────────────────────────────────

export interface ScatterPoint {
  x: number;
  y: number;
  /** Optional third dimension encoded as dot radius. Values are
   *  normalized within the chart so a 0/1 scaling matters only as a
   *  ratio between points. */
  size?: number;
  /** Free-form label shown in the hover tooltip. Recommended format:
   *  "value1 · value2 · context". */
  label?: string;
}

/** Scatter plot for two continuous variables. Used on /pipeline to
 *  compare how fast a person converted vs. how engaged they stayed
 *  after, with an optional 3rd dimension (e.g. group lifespan) as dot
 *  size. Dots are translucent so dense clusters reveal a shape; hover
 *  highlights the nearest one. */
export function ScatterChart({
  points,
  xLabel,
  yLabel,
  xSuffix = "",
  ySuffix = "",
  height = 280,
  trendline = false,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xSuffix?: string;
  ySuffix?: string;
  height?: number;
  /** Draw a least-squares regression line through the points so the
   *  reader can see the broad trend without us doing the inference. */
  trendline?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const padL = 48;
  const padR = 16;
  const padT = 14;
  const padB = 36;
  const viewW = 900;
  const innerW = viewW - padL - padR;
  const innerH = height - padT - padB;

  if (points.length === 0) {
    return (
      <div className="text-xs text-muted py-10 text-center">
        Not enough data yet for an engagement scatter.
      </div>
    );
  }

  const xMax = Math.max(1, ...points.map((p) => p.x));
  // Hard-cap a percentage axis at 100 so a stray > 100 value doesn't
  // silently inflate the scale (and so the y-axis ticks always read
  // 0/25/50/75/100 — what the eye expects from a "%" suffix).
  const rawYMax = Math.max(1, ...points.map((p) => p.y));
  const yMax = ySuffix === "%" ? 100 : rawYMax;
  const sizes = points.map((p) => p.size ?? 0);
  const sizeMax = Math.max(0, ...sizes);

  const xFor = (v: number) => padL + (v / xMax) * innerW;
  const yFor = (v: number) => padT + innerH - (v / yMax) * innerH;
  const rFor = (v: number | undefined) => {
    if (sizeMax <= 0 || v == null) return 3.5;
    const norm = Math.min(1, Math.max(0, v / sizeMax));
    return 2.5 + norm * 7;
  };

  // Trend line via least-squares.
  const trend = (() => {
    if (!trendline || points.length < 3) return null;
    let sx = 0,
      sy = 0,
      sxy = 0,
      sxx = 0;
    const n = points.length;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
      sxy += p.x * p.y;
      sxx += p.x * p.x;
    }
    const denom = n * sxx - sx * sx;
    if (denom === 0) return null;
    const m = (n * sxy - sx * sy) / denom;
    const b = (sy - m * sx) / n;
    const x0 = 0;
    const x1 = xMax;
    return {
      x1: xFor(x0),
      y1: yFor(Math.max(0, Math.min(yMax, m * x0 + b))),
      x2: xFor(x1),
      y2: yFor(Math.max(0, Math.min(yMax, m * x1 + b))),
    };
  })();

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(xMax * f));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  return (
    <div>
      <svg
        viewBox={`0 0 ${viewW} ${height}`}
        className="block w-full"
        style={{ overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((v, i) => (
          <g key={`y-${i}`}>
            <line
              x1={padL}
              x2={viewW - padR}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="rgba(140,150,170,0.15)"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={yFor(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill="#7c879c"
            >
              {v}
              {ySuffix}
            </text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <g key={`x-${i}`}>
            <line
              x1={xFor(v)}
              x2={xFor(v)}
              y1={padT}
              y2={padT + innerH}
              stroke="rgba(140,150,170,0.10)"
              strokeWidth={1}
            />
            <text
              x={xFor(v)}
              y={height - padB + 14}
              textAnchor="middle"
              fontSize={10}
              fill="#7c879c"
            >
              {v}
              {xSuffix}
            </text>
          </g>
        ))}
        <text
          x={padL + innerW / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize={10}
          fill="#7c879c"
        >
          {xLabel}
        </text>
        <text
          x={-(padT + innerH / 2)}
          y={12}
          textAnchor="middle"
          fontSize={10}
          fill="#7c879c"
          transform="rotate(-90)"
        >
          {yLabel}
        </text>
        {trend && (
          <line
            x1={trend.x1}
            y1={trend.y1}
            x2={trend.x2}
            y2={trend.y2}
            stroke="#34d399"
            strokeOpacity={0.65}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
        {points.map((p, i) => {
          const isHover = hover === i;
          return (
            <circle
              key={i}
              cx={xFor(p.x)}
              cy={yFor(p.y)}
              r={rFor(p.size)}
              fill={isHover ? "#34d399" : "var(--accent)"}
              fillOpacity={isHover ? 0.9 : 0.35}
              stroke={isHover ? "#34d399" : "transparent"}
              strokeWidth={1.5}
              onMouseEnter={() => setHover(i)}
              style={{ cursor: "pointer", transition: "fill-opacity 120ms" }}
            />
          );
        })}
      </svg>
      <div className="min-h-[28px] mt-1 text-xs">
        {hover != null && points[hover] && (
          <span className="text-muted">
            <span className="text-fg tnum">
              {points[hover].x}
              {xSuffix}
            </span>{" "}
            to convert · attendance{" "}
            <span className="text-fg tnum">
              {points[hover].y}%
            </span>
            {points[hover].label && (
              <span className="ml-2">· {points[hover].label}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Inline horizontal box-and-whisker — one box rendered in-line as a
 *  table cell so each breakdown row shows its distribution shape.
 *  `scaleMax` is shared across rows so boxes are comparable.
 *
 *  The numeric labels are part of the cell (not the SVG) so they stay
 *  legible at any column width — without them the rows are decorative
 *  blobs and the user has to hover the column header to know what 0 –
 *  Nd even means. */
export function BoxWhiskerRow({
  box,
  scaleMax,
  height = 18,
  unitSuffix = "d",
}: {
  box: BoxWhiskerBox;
  scaleMax: number;
  height?: number;
  unitSuffix?: string;
}) {
  const w = 220;
  const h = height;
  const denom = Math.max(1, scaleMax);
  const xScale = (v: number) => (v / denom) * w;
  // Where the median tick sits as a 0-100 percentage — used to position
  // the floating label above the box so it tracks the median.
  const medianPct = (box.median / denom) * 100;
  return (
    <div className="flex items-center gap-2 w-full max-w-[320px]">
      <span className="text-[10px] tnum text-subtle shrink-0 w-8 text-right">
        {Math.round(box.min)}
        {unitSuffix}
      </span>
      <div className="relative flex-1 min-w-0">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height }}
        >
          <line
            x1={xScale(box.min)}
            x2={xScale(box.max)}
            y1={h / 2}
            y2={h / 2}
            stroke="rgba(168,178,198,0.55)"
            strokeWidth={1}
          />
          <line
            x1={xScale(box.min)}
            x2={xScale(box.min)}
            y1={h * 0.3}
            y2={h * 0.7}
            stroke="rgba(168,178,198,0.55)"
            strokeWidth={1}
          />
          <line
            x1={xScale(box.max)}
            x2={xScale(box.max)}
            y1={h * 0.3}
            y2={h * 0.7}
            stroke="rgba(168,178,198,0.55)"
            strokeWidth={1}
          />
          <rect
            x={xScale(box.p25)}
            y={h * 0.2}
            width={Math.max(1, xScale(box.p75) - xScale(box.p25))}
            height={h * 0.6}
            fill="rgba(52,211,153,0.22)"
            stroke="#34d399"
            strokeWidth={1}
          />
          <line
            x1={xScale(box.median)}
            x2={xScale(box.median)}
            y1={h * 0.12}
            y2={h * 0.88}
            stroke="#e8ebf2"
            strokeWidth={1.5}
          />
        </svg>
        <span
          className="absolute -top-3.5 text-[10px] tnum text-fg pointer-events-none whitespace-nowrap -translate-x-1/2"
          style={{ left: `${Math.min(92, Math.max(8, medianPct))}%` }}
        >
          {Math.round(box.median)}
          {unitSuffix}
        </span>
      </div>
      <span className="text-[10px] tnum text-subtle shrink-0 w-10">
        {Math.round(box.max)}
        {unitSuffix}
      </span>
    </div>
  );
}
