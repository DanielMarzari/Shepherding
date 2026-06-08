"use client";

import { useState } from "react";
import type { DistanceBand } from "@/lib/map-analysis";

const LINE = "#eab308"; // matches the "shepherded" dot color on the map

/** Shepherded share as one continuous curve over distance from Faith
 *  Church (engaged people, within the radius). Smoothed Catmull-Rom. */
export function DistanceBandChart({ bands, avg }: { bands: DistanceBand[]; avg?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (bands.length < 2) return null;

  const width = 1000;
  const height = 240;
  const padL = 40;
  const padR = 14;
  const padT = 14;
  const padB = 40;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = bands.length;

  const maxMiles = bands[n - 1].midMiles;
  const minMiles = bands[0].midMiles;
  const span = Math.max(1, maxMiles - minMiles);
  const xFor = (mi: number) => padL + ((mi - minMiles) / span) * innerW;
  const yFor = (pct: number) => padT + innerH - (pct / 100) * innerH;

  const pts = bands.map((b) => [xFor(b.midMiles), yFor(b.shepherdedPct)] as const);

  // Catmull-Rom → cubic Bézier for a smooth single curve.
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${d} L ${pts[n - 1][0].toFixed(1)} ${yFor(0)} L ${pts[0][0].toFixed(1)} ${yFor(0)} Z`;

  const xTicks = bands.filter((_, i) => i % 2 === 0 || i === n - 1);

  function move(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestD = Infinity;
    pts.forEach(([x], i) => {
      const dd = Math.abs(x - vx);
      if (dd < bestD) { bestD = dd; best = i; }
    });
    setHover(best);
  }
  const hb = hover != null ? bands[hover] : null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: LINE }} /> Shepherded %
        </span>
        <span className="text-subtle ml-1">X = distance from Faith Church (mi)</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
      >
        {[0, 25, 50, 75, 100].map((t) => {
          const y = yFor(t);
          return (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="rgba(140,150,170,0.18)" strokeWidth={0.5} strokeDasharray="2 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">{t}%</text>
            </g>
          );
        })}
        {xTicks.map((b) => (
          <text key={b.label} x={xFor(b.midMiles)} y={height - padB + 16} textAnchor="middle" fontSize={10} fill="#7c879c">
            {b.label}
          </text>
        ))}
        {avg != null && (
          <g>
            <line x1={padL} x2={width - padR} y1={yFor(avg)} y2={yFor(avg)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="5 4" />
            <text x={width - padR} y={yFor(avg) - 4} textAnchor="end" fontSize={10} fill="#94a3b8">avg {Math.round(avg)}%</text>
          </g>
        )}
        <path d={area} fill={LINE} fillOpacity={0.1} stroke="none" />
        <path d={d} fill="none" stroke={LINE} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={hover === i ? 4 : 2.5} fill={LINE} />
        ))}
        {hover != null && (
          <line x1={pts[hover][0]} x2={pts[hover][0]} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} pointerEvents="none" />
        )}
      </svg>
      <div className="min-h-[34px] mt-1 text-xs">
        {hb ? (
          <span>
            <span className="font-medium">{hb.label} mi</span>
            <span className="text-muted ml-3">
              {hb.count.toLocaleString()} homes · <span className="text-fg tnum">{hb.shepherdedPct}%</span> shepherded
            </span>
          </span>
        ) : (
          <span className="text-subtle">Hover the curve for each distance&rsquo;s shepherded rate.</span>
        )}
      </div>
    </div>
  );
}
