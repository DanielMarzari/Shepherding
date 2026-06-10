"use client";

import { useState } from "react";

/** Returns line chart — how many people came back (after a gap longer than
 *  the activity window) in each calendar year, plotted by the year they
 *  re-entered. One accent line with year markers + hover readout. */
export function RetentionReturnsChart({
  data,
}: {
  data: Array<{ year: number; count: number }>;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) {
    return (
      <p className="text-xs text-subtle">
        Not enough return history yet — recomputed nightly with the dashboard.
      </p>
    );
  }

  const width = 1000, height = 240, padL = 44, padR = 16, padT = 16, padB = 28;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const n = data.length;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;
  const xFor = (i: number) => padL + i * stepX;
  const max = Math.max(1, ...data.map((d) => d.count));
  const yFor = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = niceTicks(max);

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(d.count).toFixed(1)}`)
    .join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const vx = ((e.clientX - rect.left) / rect.width) * width;
          setHover(Math.max(0, Math.min(n - 1, Math.round((vx - padL) / stepX))));
        }}
        onMouseLeave={() => setHover(null)}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
      >
        {ticks.map((t) => {
          const y = yFor(t);
          return (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="rgba(140,150,170,0.18)" strokeWidth={0.5} strokeDasharray="2 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#7c879c">{t.toLocaleString()}</text>
            </g>
          );
        })}
        {data.map((d, i) => (
          <text key={d.year} x={xFor(i)} y={height - padB + 16} textAnchor="middle" fontSize={10} fill="#7c879c">{d.year}</text>
        ))}
        {hover != null && (
          <line x1={xFor(hover)} x2={xFor(hover)} y1={padT} y2={padT + innerH} stroke="rgba(168,178,198,0.5)" strokeWidth={1} pointerEvents="none" />
        )}
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={d.year} cx={xFor(i)} cy={yFor(d.count)} r={hover === i ? 4.5 : 3} fill="var(--accent)" />
        ))}
      </svg>
      <div className="min-h-[20px] mt-1 text-xs">
        {hover != null ? (
          <span>
            <span className="font-medium">{data[hover].year}</span>
            <span className="text-muted ml-3">{data[hover].count.toLocaleString()} returned</span>
          </span>
        ) : (
          <span className="text-subtle">People who lapsed past the activity window, then came back — by the year they re-entered.</span>
        )}
      </div>
    </div>
  );
}

function niceTicks(max: number): number[] {
  const step = Math.max(1, Math.ceil(max / 4 / 10) * 10);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.5; v += step) out.push(v);
  return out;
}
