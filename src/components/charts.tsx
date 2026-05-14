"use client";

import { useState, type ReactNode } from "react";

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

function Tooltip({
  x,
  y,
  text,
}: {
  x: number;
  y: number;
  text: string;
}) {
  // Estimate text width; SVG <text> doesn't auto-resize background. Aim
  // small and centered above the hover point.
  const w = Math.max(56, text.length * 6.5 + 14);
  const h = 22;
  return (
    <g pointerEvents="none">
      <rect
        x={x - w / 2}
        y={y - h - 6}
        width={w}
        height={h}
        rx={4}
        fill="var(--fg)"
        fillOpacity="0.92"
      />
      <text
        x={x}
        y={y - h - 6 + 14}
        textAnchor="middle"
        fontSize="10"
        fontWeight="500"
        fill="var(--bg)"
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
}: {
  data: ChartDatum[];
  maxSlices?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return <div className="text-xs text-muted py-6 text-center">No data</div>;
  }
  const sorted = [...data].sort((a, b) => b.count - a.count);
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
      color: PALETTE[i % PALETTE.length],
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
            {total.toLocaleString()}
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
              text={`${hovered.label}: ${hovered.count.toLocaleString()} (${Math.round(hovered.pct * 100)}%)`}
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
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span
                className="text-fg flex-1 break-words"
                title={s.label}
              >
                {s.label}
              </span>
              <span className="tnum text-muted shrink-0">
                {s.count.toLocaleString()}{" "}
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
                <div className="text-[10px] tnum font-medium text-fg bg-fg/90 text-bg px-1.5 py-0.5 rounded">
                  {d.count.toLocaleString()} · {Math.round(pct)}%
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
              {d.count.toLocaleString()}
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
            text={`${hovered.d.label}: ${hovered.d.count.toLocaleString()}`}
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
          {unknown.toLocaleString()} unknown (no birthdate on file)
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

  function pathFor(values: number[]): string {
    return values
      .map((v, i) => {
        const x = padX + i * stepX;
        const y = padTop + innerH - (v / yTop) * innerH;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }

  // Hovered point coordinates.
  const hoveredPoint = (() => {
    if (!hover) return null;
    const s = resolved[hover.seriesIdx];
    const x = padX + hover.pointIdx * stepX;
    const y = padTop + innerH - (s.plotValues[hover.pointIdx] / yTop) * innerH;
    return { x, y, s, idx: hover.pointIdx };
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
                {yMode === "percent" ? `${tick}%` : tick.toLocaleString()}
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
          <g key={s.label}>
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
            {s.plotValues.map((v, j) => {
              const x = padX + j * stepX;
              const y = padTop + innerH - (v / yTop) * innerH;
              return (
                <circle
                  key={j}
                  cx={x}
                  cy={y}
                  r={hover?.seriesIdx === i && hover?.pointIdx === j ? 4 : 2}
                  fill={PALETTE[i % PALETTE.length]}
                  style={{
                    opacity: hover == null || hover.seriesIdx === i ? 1 : 0.3,
                    transition: "r 100ms",
                  }}
                />
              );
            })}
          </g>
        ))}
        {/* Invisible hit columns per (x, series) for hover. */}
        {resolved.flatMap((s, i) =>
          s.plotValues.map((v, j) => {
            const x = padX + j * stepX;
            return (
              <rect
                key={`${i}-${j}`}
                x={x - stepX / 2}
                y={padTop}
                width={stepX}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover({ seriesIdx: i, pointIdx: j })}
                onMouseLeave={() => setHover(null)}
              />
            );
          }),
        )}
        {hoveredPoint && (
          <Tooltip
            x={hoveredPoint.x}
            y={hoveredPoint.y}
            text={
              yMode === "percent"
                ? `${hoveredPoint.s.label} · ${xLabels[hoveredPoint.idx]}: ${Math.round(
                    hoveredPoint.s.plotValues[hoveredPoint.idx],
                  )}% (${hoveredPoint.s.values[hoveredPoint.idx].toLocaleString()} of ${
                    hoveredPoint.s.denom[hoveredPoint.idx]?.toLocaleString() ?? "?"
                  })`
                : `${hoveredPoint.s.label} · ${xLabels[hoveredPoint.idx]}: ${hoveredPoint.s.values[hoveredPoint.idx].toLocaleString()}`
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
