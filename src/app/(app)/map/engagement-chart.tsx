"use client";

import { useState } from "react";
import type { EngagementBin } from "@/lib/map-analysis";

const SHEP = "#5dc8a8";
const ENG = "#3b82f6";

/** Engagement vs. travel time: for each drive-time band, the share who
 *  are shepherded (in a group/team) and the share who are engaged at all
 *  (not inactive). Shows whether distance dampens connection. */
export function EngagementChart({ bins }: { bins: EngagementBin[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (bins.length < 2) return null;

  const width = 1000;
  const height = 260;
  const padL = 40;
  const padR = 14;
  const padT = 14;
  const padB = 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = bins.length;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;
  const xFor = (i: number) => padL + i * stepX;
  const yFor = (pct: number) => padT + innerH - (pct / 100) * innerH;

  const line = (get: (b: EngagementBin) => number) =>
    bins.map((b, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(get(b)).toFixed(1)}`).join(" ");

  function move(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    setHover(Math.max(0, Math.min(n - 1, Math.round((vx - padL) / stepX))));
  }
  const hb = hover != null ? bins[hover] : null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SHEP }} /> Shepherded %
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: ENG }} /> Engaged % (not inactive)
        </span>
        <span className="text-subtle ml-1">X = drive time from Faith Church</span>
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
        {bins.map((b, i) => (
          <text key={b.label} x={xFor(i)} y={height - padB + 14} textAnchor="middle" fontSize={10} fill="#7c879c">
            {b.label}
          </text>
        ))}
        <path d={line((b) => b.engagedPct)} fill="none" stroke={ENG} strokeWidth={2} />
        <path d={line((b) => b.shepherdedPct)} fill="none" stroke={SHEP} strokeWidth={2} />
        {bins.map((b, i) => (
          <g key={`d${i}`}>
            <circle cx={xFor(i)} cy={yFor(b.engagedPct)} r={2.5} fill={ENG} />
            <circle cx={xFor(i)} cy={yFor(b.shepherdedPct)} r={2.5} fill={SHEP} />
          </g>
        ))}
        {hover != null && (
          <line x1={xFor(hover)} x2={xFor(hover)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} pointerEvents="none" />
        )}
      </svg>
      <div className="min-h-[34px] mt-1 text-xs">
        {hb ? (
          <span>
            <span className="font-medium">{hb.label} min</span>
            <span className="text-muted ml-3">
              {hb.count.toLocaleString()} homes · <span className="text-fg tnum">{hb.shepherdedPct}%</span> shepherded ·{" "}
              <span className="text-fg tnum">{hb.engagedPct}%</span> engaged
            </span>
          </span>
        ) : (
          <span className="text-subtle">Hover a band for its rates.</span>
        )}
      </div>
    </div>
  );
}
