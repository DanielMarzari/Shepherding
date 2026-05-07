"use client";

import { useState } from "react";

interface Bucket {
  label: string;
  visitsPerYear: number;
  people: number;
  pct: number;
}

interface Distribution {
  buckets: Bucket[];
  expected: number;
  targetWeekly: number;
  decayRatio: number;
  impliedWeekly: number;
}

export function DistributionChart({ distribution }: { distribution: Distribution }) {
  // X axis runs frequent → rare: "Every week" on the left.
  const ordered = distribution.buckets;
  const max = Math.max(...ordered.map((b) => b.people), 1);
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 240;
  const padL = 30;
  const padR = 20;
  const padT = 28;
  const padB = 64;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const points = ordered.map((b, i) => {
    const x = padL + (innerW * i) / (ordered.length - 1);
    const y = padT + innerH - (b.people / max) * innerH;
    return { x, y, b, i };
  });

  // Smooth Catmull-Rom-ish curve through the points
  function smoothPath(): string {
    if (points.length < 2) return "";
    const cmds: string[] = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
    const tension = 0.45;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] ?? points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) * tension * 0.5;
      const c1y = p1.y + (p2.y - p0.y) * tension * 0.5;
      const c2x = p2.x - (p3.x - p1.x) * tension * 0.5;
      const c2y = p2.y - (p3.y - p1.y) * tension * 0.5;
      cmds.push(
        `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
      );
    }
    return cmds.join(" ");
  }

  const linePath = smoothPath();
  const last = points[points.length - 1];
  const first = points[0];
  const areaPath = `${linePath} L ${last.x.toFixed(1)} ${(padT + innerH).toFixed(1)} L ${first.x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  const hoverPt = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Attendance frequency distribution"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="att-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.30" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* y-axis grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => {
          const y = padT + innerH - g * innerH;
          return (
            <line
              key={g}
              x1={padL}
              x2={W - padR}
              y1={y}
              y2={y}
              stroke="var(--border-soft)"
              strokeDasharray="2 4"
            />
          );
        })}

        {/* fill */}
        <path d={areaPath} fill="url(#att-fill)" />

        {/* line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* points + transparent hover targets */}
        {points.map((p) => (
          <g key={p.b.label}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === p.i ? 6 : 4}
              fill="var(--accent)"
              stroke="var(--bg-elev)"
              strokeWidth={hover === p.i ? 3 : 2}
            />
            {/* big invisible hit target */}
            <rect
              x={p.x - innerW / (points.length * 2)}
              y={padT}
              width={innerW / points.length}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(p.i)}
              onFocus={() => setHover(p.i)}
              tabIndex={0}
              style={{ cursor: "default" }}
            />
            {/* x-axis label */}
            <text
              x={p.x}
              y={padT + innerH + 18}
              textAnchor="middle"
              fontSize="10"
              fill="var(--fg-muted)"
            >
              {p.b.label}
            </text>
            <text
              x={p.x}
              y={padT + innerH + 32}
              textAnchor="middle"
              fontSize="9"
              fill="var(--fg-subtle)"
            >
              {p.b.visitsPerYear}/yr
            </text>
          </g>
        ))}

        {/* Hover guide line + tooltip box */}
        {hoverPt && (
          <>
            <line
              x1={hoverPt.x}
              x2={hoverPt.x}
              y1={padT}
              y2={padT + innerH}
              stroke="var(--accent)"
              strokeOpacity="0.5"
              strokeDasharray="3 3"
            />
            <Tooltip pt={hoverPt} svgWidth={W} padR={padR} />
          </>
        )}
      </svg>
    </div>
  );
}

function Tooltip({
  pt,
  svgWidth,
  padR,
}: {
  pt: { x: number; y: number; b: Bucket };
  svgWidth: number;
  padR: number;
}) {
  const boxW = 160;
  const boxH = 56;
  // Position above and to the side of the point
  const placeRight = pt.x + boxW + 12 < svgWidth - padR;
  const x = placeRight ? pt.x + 12 : pt.x - boxW - 12;
  const y = Math.max(0, pt.y - boxH - 10);
  return (
    <g pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={boxW}
        height={boxH}
        rx="6"
        fill="var(--bg-elev)"
        stroke="var(--border-soft)"
      />
      <text x={x + 10} y={y + 18} fontSize="11" fontWeight="600" fill="var(--fg)">
        {pt.b.label}
      </text>
      <text x={x + 10} y={y + 34} fontSize="11" fill="var(--fg-muted)">
        {pt.b.visitsPerYear} visits / year
      </text>
      <text
        x={x + boxW - 10}
        y={y + 18}
        textAnchor="end"
        fontSize="13"
        fontWeight="600"
        fill="var(--accent)"
      >
        {pt.b.people.toLocaleString()}
      </text>
      <text
        x={x + boxW - 10}
        y={y + 34}
        textAnchor="end"
        fontSize="10"
        fill="var(--fg-muted)"
      >
        {(pt.b.pct * 100).toFixed(1)}% of total
      </text>
    </g>
  );
}
